/**
 * Odoo Discuss Channel Plugin
 *
 * Main channel plugin definition for OpenClaw.
 */

import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
import {
  createScopedChannelConfigAdapter,
  createScopedDmSecurityResolver,
} from "openclaw/plugin-sdk/channel-config-helpers";
import { createChatChannelPlugin, type ChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import {
  createMessageReceiptFromOutboundResults,
  defineChannelMessageAdapter,
  type MessageReceipt,
  type MessageReceiptPartKind,
} from "openclaw/plugin-sdk/channel-message";
import {
  composeWarningCollectors,
  createConditionalWarningCollector,
  projectAccountWarningCollector,
} from "openclaw/plugin-sdk/channel-policy";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { createEmptyChannelDirectoryAdapter } from "openclaw/plugin-sdk/directory-runtime";
import {
  createComputedAccountStatusAdapter,
  createDefaultChannelRuntimeState,
} from "openclaw/plugin-sdk/status-helpers";
import { normalizeLowercaseStringOrEmpty } from "openclaw/plugin-sdk/string-coerce-runtime";
import {
  listOdooDiscussAccountIds,
  resolveOdooDiscussAccount,
  resolveDefaultAccountId,
  type CoreConfig,
} from "./accounts.js";
import { startOdooDiscussGatewayAccount } from "./gateway.js";
import { probeOdooDiscuss } from "./probe.js";
import { sendMessageOdooDiscuss } from "./send.js";
import type { ResolvedOdooDiscussAccount, OdooDiscussProbe } from "./types.js";

const CHANNEL_ID = "odoo-discuss";

const meta = {
  id: CHANNEL_ID,
  label: "Odoo Discuss",
  selectionLabel: "Odoo Discuss (ERP Chat)",
  detailLabel: "Odoo Discuss",
  docsPath: "/channels/odoo-discuss",
  docsLabel: "odoo-discuss",
  blurb: "Odoo ERP internal messaging via XML-RPC",
  order: 150,
  systemImage: "message",
  markdownCapable: false,
};

const odooDiscussConfigAdapter = createScopedChannelConfigAdapter<
  ResolvedOdooDiscussAccount,
  ResolvedOdooDiscussAccount
>({
  sectionKey: CHANNEL_ID,
  listAccountIds: (cfg) => listOdooDiscussAccountIds(cfg as CoreConfig),
  resolveAccount: (cfg, accountId) =>
    resolveOdooDiscussAccount({ cfg: cfg as CoreConfig, accountId }),
  defaultAccountId: resolveDefaultAccountId,
  clearBaseFields: [
    "url",
    "db",
    "user",
    "password",
    "pollIntervalMs",
    "defaultChannelId",
    "allowFrom",
    "dmPolicy",
    "groupPolicy",
    "allowedChannels",
    "botName",
    "presenceEnabled",
  ],
  resolveAllowFrom: (account) => account.config.allowFrom ?? [],
  formatAllowFrom: (allowFrom) =>
    allowFrom.map((entry) => normalizeLowercaseStringOrEmpty(String(entry))).filter(Boolean),
});

const resolveOdooDiscussDmPolicy = createScopedDmSecurityResolver<ResolvedOdooDiscussAccount>({
  channelKey: CHANNEL_ID,
  resolvePolicy: (account) => account.config.dmPolicy,
  resolveAllowFrom: (account) => account.config.allowFrom,
  policyPathSuffix: "dmPolicy",
  defaultPolicy: "allowlist",
  approveHint: "openclaw pairing approve odoo-discuss <userId>",
  normalizeEntry: (raw) => normalizeLowercaseStringOrEmpty(raw),
});

const collectOdooDiscussSecurityWarnings =
  createConditionalWarningCollector<ResolvedOdooDiscussAccount>(
    (account) => !account.config.url && "- Odoo Discuss: URL is not configured.",
    (account) => !account.config.db && "- Odoo Discuss: Database is not configured.",
    (account) => !account.config.user && "- Odoo Discuss: User is not configured.",
    (account) => !account.config.password && "- Odoo Discuss: Password/API key is not configured.",
    (account) =>
      account.config.dmPolicy === "open" &&
      (account.config.allowFrom?.length ?? 0) === 0 &&
      '- Odoo Discuss: dmPolicy="open" with empty allowFrom allows any user to message the bot.',
    (account) =>
      account.config.groupPolicy === "open" &&
      (account.config.allowedChannels?.length ?? 0) === 0 &&
      '- Odoo Discuss: groupPolicy="open" with empty allowedChannels allows monitoring all channels.',
  );

type OdooDiscussOutboundResult = {
  channel: typeof CHANNEL_ID;
  messageId: string;
  chatId: string;
  receipt: MessageReceipt;
};

function createOdooDiscussSendResult(params: {
  messageId: number;
  chatId: number;
  kind: MessageReceiptPartKind;
}): OdooDiscussOutboundResult {
  return {
    channel: CHANNEL_ID,
    messageId: String(params.messageId),
    chatId: String(params.chatId),
    receipt: createMessageReceiptFromOutboundResults({
      results: [
        {
          channel: CHANNEL_ID,
          messageId: String(params.messageId),
          chatId: String(params.chatId),
          conversationId: String(params.chatId),
        },
      ],
      threadId: String(params.chatId),
      kind: params.kind,
    }),
  };
}

const odooDiscussMessageAdapter = defineChannelMessageAdapter({
  id: CHANNEL_ID,
  durableFinal: {
    capabilities: {
      text: true,
      media: false,
      messageSendingHooks: true,
    },
  },
  send: {
    text: async (ctx) => {
      const channelId = parseInt(ctx.to, 10);
      if (isNaN(channelId)) {
        throw new Error(`Invalid Odoo Discuss channel ID: ${ctx.to}`);
      }
      const messageId = await sendMessageOdooDiscuss(channelId, ctx.text, {
        cfg: ctx.cfg as CoreConfig,
        accountId: ctx.accountId ?? undefined,
      });
      return createOdooDiscussSendResult({
        messageId,
        chatId: channelId,
        kind: "text",
      });
    },
    media: async (ctx) => {
      // Odoo Discuss doesn't support direct media uploads via XML-RPC
      // Include media URL in the text
      const channelId = parseInt(ctx.to, 10);
      if (isNaN(channelId)) {
        throw new Error(`Invalid Odoo Discuss channel ID: ${ctx.to}`);
      }
      const text = ctx.mediaUrl
        ? `${ctx.text ?? ""}\n\nAttachment: ${ctx.mediaUrl}`.trim()
        : (ctx.text ?? "");
      const messageId = await sendMessageOdooDiscuss(channelId, text, {
        cfg: ctx.cfg as CoreConfig,
        accountId: ctx.accountId ?? undefined,
      });
      return createOdooDiscussSendResult({
        messageId,
        chatId: channelId,
        kind: "media",
      });
    },
  },
});

export const odooDiscussPlugin: ChannelPlugin<ResolvedOdooDiscussAccount, OdooDiscussProbe> =
  createChatChannelPlugin({
    base: {
      id: CHANNEL_ID,
      meta: {
        ...meta,
        quickstartAllowFrom: true,
      },
      capabilities: {
        chatTypes: ["direct", "group"],
        media: false,
        blockStreaming: false,
        threads: false,
        reactions: false,
        edit: false,
        unsend: false,
        reply: false,
        effects: false,
      },
      reload: { configPrefixes: [`channels.${CHANNEL_ID}`] },
      config: {
        ...odooDiscussConfigAdapter,
        hasConfiguredState: ({ env }) =>
          typeof env?.ODOO_URL === "string" &&
          env.ODOO_URL.trim().length > 0 &&
          typeof env?.ODOO_USER === "string" &&
          env.ODOO_USER.trim().length > 0,
        isConfigured: (account) => account.configured,
      },
      messaging: {
        targetPrefixes: ["odoo-discuss", "odoo"],
        normalizeTarget: (target: string) => {
          const trimmed = target.trim();
          if (!trimmed) return undefined;
          return trimmed.replace(/^odoo(?:-discuss)?:/i, "").trim();
        },
        targetResolver: {
          looksLikeId: (id: string) => {
            const trimmed = id?.trim();
            if (!trimmed) return false;
            return /^\d+$/.test(trimmed) || /^odoo(?:-discuss)?:/i.test(trimmed);
          },
          hint: "<channelId>",
        },
      },
      directory: createEmptyChannelDirectoryAdapter(),
      status: createComputedAccountStatusAdapter<ResolvedOdooDiscussAccount, OdooDiscussProbe>({
        defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID),
        buildChannelSummary: ({ account, snapshot }) => ({
          configured: account.configured,
          connected: snapshot.probe?.kind === "connected",
          label: account.config.url || "Not configured",
          url: account.config.url,
          user: account.config.user,
          probe: snapshot.probe,
          lastProbeAt: snapshot.lastProbeAt ?? null,
        }),
        probeAccount: async ({ cfg, account, timeoutMs }) =>
          probeOdooDiscuss(cfg as CoreConfig, {
            accountId: account.accountId,
            timeoutMs,
          }),
        resolveAccountSnapshot: ({ account }) => ({
          accountId: account.accountId,
          name: account.config.botName,
          enabled: account.enabled,
          configured: account.configured,
          extra: {
            url: account.config.url,
            user: account.config.user,
          },
        }),
      }),
      gateway: {
        startAccount: async (ctx) =>
          await startOdooDiscussGatewayAccount({
            ...ctx,
            cfg: ctx.cfg as CoreConfig,
          }),
      },
      message: odooDiscussMessageAdapter,
    },
    pairing: {
      text: {
        idLabel: "odooUserId",
        message: "OpenClaw: your access has been approved.",
        normalizeAllowEntry: (entry: string) => normalizeLowercaseStringOrEmpty(entry),
        notify: async ({ cfg, id, message }) => {
          // Can't notify via DM in Odoo without a channel
          // This would need a default channel ID configured
          const config = (cfg as CoreConfig)?.channels?.["odoo-discuss"];
          if (config?.defaultChannelId) {
            await sendMessageOdooDiscuss(config.defaultChannelId, `@${id}: ${message}`, {
              cfg: cfg as CoreConfig,
            });
          }
        },
      },
    },
    security: {
      resolveDmPolicy: resolveOdooDiscussDmPolicy,
      collectWarnings: composeWarningCollectors(
        projectAccountWarningCollector<
          ResolvedOdooDiscussAccount,
          { cfg: OpenClawConfig; account: ResolvedOdooDiscussAccount }
        >(collectOdooDiscussSecurityWarnings),
      ),
    },
    outbound: {
      deliveryMode: "gateway" as const,
      textChunkLimit: 10000,
      sendText: async (ctx) => {
        const channelId = parseInt(ctx.to, 10);
        if (isNaN(channelId)) {
          throw new Error(`Invalid Odoo Discuss channel ID: ${ctx.to}`);
        }
        const messageId = await sendMessageOdooDiscuss(channelId, ctx.text, {
          cfg: ctx.cfg as CoreConfig,
          accountId: ctx.accountId ?? undefined,
        });
        return createOdooDiscussSendResult({
          messageId,
          chatId: channelId,
          kind: "text",
        });
      },
      sendMedia: async (ctx) => {
        const channelId = parseInt(ctx.to, 10);
        if (isNaN(channelId)) {
          throw new Error(`Invalid Odoo Discuss channel ID: ${ctx.to}`);
        }
        const text = ctx.mediaUrl
          ? `${ctx.text ?? ""}\n\nAttachment: ${ctx.mediaUrl}`.trim()
          : (ctx.text ?? "");
        const messageId = await sendMessageOdooDiscuss(channelId, text, {
          cfg: ctx.cfg as CoreConfig,
          accountId: ctx.accountId ?? undefined,
        });
        return createOdooDiscussSendResult({
          messageId,
          chatId: channelId,
          kind: "media",
        });
      },
    },
  });
