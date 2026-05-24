/**
 * Odoo Discuss Inbound Message Handler
 *
 * Processes incoming messages from Odoo Discuss.
 */

import { logInboundDrop } from "openclaw/plugin-sdk/channel-inbound";
import {
  channelIngressRoutes,
  createChannelIngressResolver,
  defineStableChannelIngressIdentity,
} from "openclaw/plugin-sdk/channel-ingress-runtime";
import { createChannelPairingController } from "openclaw/plugin-sdk/channel-pairing";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { resolveInboundRouteEnvelopeBuilderWithRuntime } from "openclaw/plugin-sdk/inbound-envelope";
import {
  deliverFormattedTextWithAttachments,
  type OutboundReplyPayload,
} from "openclaw/plugin-sdk/reply-payload";
import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime";
import {
  GROUP_POLICY_BLOCKED_LABEL,
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
  warnMissingProviderGroupPolicyFallbackOnce,
} from "openclaw/plugin-sdk/runtime-group-policy";
import { normalizeLowercaseStringOrEmpty } from "openclaw/plugin-sdk/string-coerce-runtime";
import type { CoreConfig } from "./accounts.js";
import { getOdooDiscussRuntime } from "./runtime.js";
import { sendMessageOdooDiscuss } from "./send.js";
import type { ResolvedOdooDiscussAccount, OdooInboundMessage } from "./types.js";

const CHANNEL_ID = "odoo-discuss" as const;

const odooDiscussIngressIdentity = defineStableChannelIngressIdentity({
  key: "odoo-discuss-id",
  normalizeEntry: (value: string) => normalizeLowercaseStringOrEmpty(value),
  normalizeSubject: normalizeLowercaseStringOrEmpty,
  sensitivity: "pii",
  aliases: [],
  isWildcardEntry: (entry: string) => entry === "*",
  resolveEntryId: ({ entryIndex, fieldKey }) => `odoo-entry-${entryIndex + 1}:${fieldKey}`,
});

function createOdooIngressSubject(message: OdooInboundMessage) {
  const senderId = String(message.senderId);
  return {
    stableId: senderId,
    aliases: {},
  };
}

function routeDescriptorsForOdooGroup(params: {
  isGroup: boolean;
  groupPolicy: "open" | "allowlist" | "disabled";
  groupAllowed: boolean;
}) {
  if (!params.isGroup) {
    return [];
  }
  return channelIngressRoutes(
    params.groupPolicy === "allowlist" && {
      id: "odoo:channel",
      allowed: params.groupAllowed,
      precedence: 0,
      matchId: "odoo-channel",
      blockReason: "channel_not_allowlisted",
    },
  );
}

async function deliverOdooReply(params: {
  payload: OutboundReplyPayload;
  cfg: CoreConfig;
  channelId: number;
  accountId: string;
  sendReply?: (channelId: number, text: string) => Promise<void>;
  statusSink?: (patch: { lastOutboundAt?: number }) => void;
}) {
  await deliverFormattedTextWithAttachments({
    payload: params.payload,
    send: async ({ text }) => {
      if (params.sendReply) {
        await params.sendReply(params.channelId, text);
      } else {
        await sendMessageOdooDiscuss(params.channelId, text, {
          cfg: params.cfg,
          accountId: params.accountId,
        });
      }
      params.statusSink?.({ lastOutboundAt: Date.now() });
    },
  });
}

export async function handleOdooDiscussInbound(params: {
  message: OdooInboundMessage;
  account: ResolvedOdooDiscussAccount;
  config: CoreConfig;
  runtime: RuntimeEnv;
  sendReply?: (channelId: number, text: string) => Promise<void>;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<void> {
  const { message, account, config, runtime, statusSink } = params;
  const core = getOdooDiscussRuntime();
  const pairing = createChannelPairingController({
    core,
    channel: CHANNEL_ID,
    accountId: account.accountId,
  });

  const rawBody = message.body?.trim() ?? "";
  if (!rawBody) {
    return;
  }

  statusSink?.({ lastInboundAt: message.timestamp });

  const senderDisplay = `${message.senderName} (${message.senderId})`;
  const dmPolicy = account.config.dmPolicy ?? "allowlist";
  const defaultGroupPolicy = resolveDefaultGroupPolicy(config as OpenClawConfig);
  const { groupPolicy, providerMissingFallbackApplied } =
    resolveAllowlistProviderRuntimeGroupPolicy({
      providerConfigPresent: config.channels?.["odoo-discuss"] !== undefined,
      groupPolicy: account.config.groupPolicy,
      defaultGroupPolicy,
    });
  warnMissingProviderGroupPolicyFallbackOnce({
    providerMissingFallbackApplied,
    providerKey: "odoo-discuss",
    accountId: account.accountId,
    blockedLabel: GROUP_POLICY_BLOCKED_LABEL.channel,
    log: (msg) => runtime.log?.(msg),
  });

  // Check if channel is in allowedChannels
  const allowedChannels = account.config.allowedChannels ?? [];
  const groupAllowed =
    groupPolicy === "open" ||
    allowedChannels.length === 0 ||
    allowedChannels.includes(message.channelId);

  const allowTextCommands = core.channel.commands.shouldHandleTextCommands({
    cfg: config as OpenClawConfig,
    surface: CHANNEL_ID,
  });
  const hasControlCommand = core.channel.text.hasControlCommand(rawBody, config as OpenClawConfig);
  const mentionRegexes = core.channel.mentions.buildMentionRegexes(config as OpenClawConfig);
  const wasMentioned = core.channel.mentions.matchesMentionPatterns(rawBody, mentionRegexes);

  const access = await createChannelIngressResolver({
    channelId: CHANNEL_ID,
    accountId: account.accountId,
    identity: odooDiscussIngressIdentity,
    cfg: config as OpenClawConfig,
    readStoreAllowFrom: async () => await pairing.readAllowFromStore(),
  }).message({
    subject: createOdooIngressSubject(message),
    conversation: {
      kind: message.isGroup ? "group" : "direct",
      id: String(message.channelId),
    },
    route: routeDescriptorsForOdooGroup({
      isGroup: message.isGroup,
      groupPolicy,
      groupAllowed,
    }),
    mentionFacts: message.isGroup
      ? {
          canDetectMention: true,
          wasMentioned,
          hasAnyMention: wasMentioned,
        }
      : undefined,
    dmPolicy,
    groupPolicy,
    policy: {
      groupAllowFromFallbackToAllowFrom: false,
      mutableIdentifierMatching: "disabled",
      activation: {
        requireMention: message.isGroup,
        allowTextCommands,
      },
    },
    allowFrom: account.config.allowFrom?.map(String) ?? [],
    groupAllowFrom: [],
    command: {
      allowTextCommands,
      hasControlCommand,
    },
  });

  if (access.ingress.admission === "pairing-required") {
    await pairing.issueChallenge({
      senderId: String(message.senderId),
      senderIdLine: `Your Odoo user ID: ${message.senderId}`,
      meta: { name: message.senderName || undefined },
      sendPairingReply: async (text) => {
        await deliverOdooReply({
          payload: { text },
          cfg: config,
          channelId: message.channelId,
          accountId: account.accountId,
          sendReply: params.sendReply,
          statusSink,
        });
      },
      onReplyError: (err) => {
        runtime.error?.(`odoo-discuss: pairing reply failed for ${senderDisplay}: ${String(err)}`);
      },
    });
    runtime.log?.(`odoo-discuss: drop DM sender ${senderDisplay} (dmPolicy=${dmPolicy})`);
    return;
  }

  if (access.ingress.admission === "skip") {
    runtime.log?.(`odoo-discuss: drop channel ${message.channelId} (missing-mention)`);
    return;
  }

  if (access.ingress.admission !== "dispatch") {
    if (message.isGroup) {
      if (access.routeAccess.reason === "channel_not_allowlisted") {
        runtime.log?.(`odoo-discuss: drop channel ${message.channelId} (not allowlisted)`);
      } else {
        runtime.log?.(`odoo-discuss: drop group sender ${senderDisplay} (policy=${groupPolicy})`);
      }
    } else {
      runtime.log?.(`odoo-discuss: drop DM sender ${senderDisplay} (dmPolicy=${dmPolicy})`);
    }
    logInboundDrop({
      log: (line) => runtime.log?.(line),
      channel: CHANNEL_ID,
      reason: access.ingress.admission,
      target: senderDisplay,
    });
    return;
  }

  const peerId = String(message.channelId);
  const { route, buildEnvelope } = resolveInboundRouteEnvelopeBuilderWithRuntime({
    cfg: config as OpenClawConfig,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer: {
      kind: message.isGroup ? "group" : "direct",
      id: peerId,
    },
    runtime: core.channel,
    sessionStore: (config as OpenClawConfig).session?.store,
  });

  const fromLabel = message.isGroup ? message.channelName : senderDisplay;
  const { storePath, body } = buildEnvelope({
    channel: "Odoo Discuss",
    from: fromLabel,
    timestamp: message.timestamp,
    body: rawBody,
  });

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: message.isGroup
      ? `odoo-discuss:channel:${message.channelId}`
      : `odoo-discuss:${message.senderId}`,
    To: `odoo-discuss:${peerId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: message.isGroup ? "group" : "direct",
    ConversationLabel: fromLabel,
    SenderName: message.senderName || undefined,
    SenderId: String(message.senderId),
    GroupSubject: message.isGroup ? message.channelName : undefined,
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    WasMentioned: message.isGroup ? wasMentioned : undefined,
    MessageSid: message.messageId,
    Timestamp: message.timestamp,
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: `odoo-discuss:${peerId}`,
    CommandAuthorized: access.commandAccess.authorized,
  });

  await core.channel.turn.runAssembled({
    cfg: config as OpenClawConfig,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    agentId: route.agentId,
    routeSessionKey: route.sessionKey,
    storePath,
    ctxPayload,
    recordInboundSession: core.channel.session.recordInboundSession,
    dispatchReplyWithBufferedBlockDispatcher:
      core.channel.reply.dispatchReplyWithBufferedBlockDispatcher,
    delivery: {
      deliver: async (payload) => {
        await deliverOdooReply({
          payload,
          cfg: config,
          channelId: message.channelId,
          accountId: account.accountId,
          sendReply: params.sendReply,
          statusSink,
        });
      },
      onError: (err, info) => {
        runtime.error?.(`odoo-discuss ${info.kind} reply failed: ${String(err)}`);
      },
    },
    replyPipeline: {},
    replyOptions: {},
    record: {
      onRecordError: (err) => {
        runtime.error?.(`odoo-discuss: failed updating session meta: ${String(err)}`);
      },
    },
  });
}
