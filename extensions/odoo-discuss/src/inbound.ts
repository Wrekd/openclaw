/**
 * Odoo Discuss Inbound Message Handler
 *
 * Processes incoming messages from Odoo Discuss.
 */

import {
  classifyChannelInboundEvent,
  logInboundDrop,
  resolveUnmentionedGroupInboundPolicy,
} from "openclaw/plugin-sdk/channel-inbound";
import {
  channelIngressRoutes,
  createChannelIngressResolver,
  defineStableChannelIngressIdentity,
} from "openclaw/plugin-sdk/channel-ingress-runtime";
import { createChannelPairingController } from "openclaw/plugin-sdk/channel-pairing";
import { resolveChannelGroupRequireMention } from "openclaw/plugin-sdk/channel-policy";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { resolveInboundRouteEnvelopeBuilderWithRuntime } from "openclaw/plugin-sdk/inbound-envelope";
import {
  deliverFormattedTextWithAttachments,
  isReasoningReplyPayload,
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
import { sanitizeAssistantVisibleText } from "openclaw/plugin-sdk/text-chunking";
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
  log?: (line: string) => void;
}) {
  if (isReasoningReplyPayload(params.payload)) {
    params.log?.(`odoo-discuss: deliver skip channel=${params.channelId} reason=reasoning-only`);
    return;
  }
  await deliverFormattedTextWithAttachments({
    payload: params.payload,
    send: async ({ text }) => {
      const clean = sanitizeAssistantVisibleText(text).trim();
      if (!clean) {
        params.log?.(
          `odoo-discuss: deliver skip channel=${params.channelId} reason=empty-text rawLen=${text.length}`,
        );
        return;
      }
      params.log?.(`odoo-discuss: deliver send channel=${params.channelId} chars=${clean.length}`);
      if (params.sendReply) {
        await params.sendReply(params.channelId, clean);
      } else {
        await sendMessageOdooDiscuss(params.channelId, clean, {
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
  const mentionRegexes = core.channel.mentions.buildMentionRegexes(
    config as OpenClawConfig,
    route.agentId,
  );
  const wasMentioned = core.channel.mentions.matchesMentionPatterns(rawBody, mentionRegexes);
  const unmentionedGroupPolicy = resolveUnmentionedGroupInboundPolicy({
    cfg: config as OpenClawConfig,
    agentId: route.agentId,
  });
  const groupRequireMention = message.isGroup
    ? resolveChannelGroupRequireMention({
        cfg: config as OpenClawConfig,
        channel: CHANNEL_ID,
        groupId: String(message.channelId),
        accountId: account.accountId,
        configuredGroupDefaultsToNoMention: true,
      })
    : false;
  // Ambient room_event mode: let unmentioned group messages flow so the agent decides whether to chime in.
  const requireMention =
    message.isGroup && unmentionedGroupPolicy !== "room_event" && groupRequireMention;
  runtime.log?.(
    `odoo-discuss: mention-debug agent=${route.agentId} regexes=${mentionRegexes.length} matched=${wasMentioned} requireMention=${requireMention} unmentionedPolicy=${unmentionedGroupPolicy} body=${JSON.stringify(rawBody.slice(0, 200))}`,
  );

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
          implicitMentionKinds: message.replyToBot ? ["reply_to_bot"] : [],
        }
      : undefined,
    dmPolicy,
    groupPolicy,
    policy: {
      groupAllowFromFallbackToAllowFrom: false,
      mutableIdentifierMatching: "disabled",
      activation: {
        requireMention,
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
          log: (line) => runtime.log?.(line),
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

  const fromLabel = message.isGroup ? message.channelName : senderDisplay;
  const { storePath, body } = buildEnvelope({
    channel: "Odoo Discuss",
    from: fromLabel,
    timestamp: message.timestamp,
    body: rawBody,
  });

  const effectiveWasMentioned = access.activationAccess.effectiveWasMentioned ?? wasMentioned;
  const inboundEventKind = classifyChannelInboundEvent({
    conversation: { kind: message.isGroup ? "group" : "direct" },
    unmentionedGroupPolicy,
    wasMentioned: effectiveWasMentioned,
    hasControlCommand,
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
    WasMentioned: message.isGroup ? effectiveWasMentioned : undefined,
    MessageSid: message.messageId,
    Timestamp: message.timestamp,
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: `odoo-discuss:${peerId}`,
    CommandAuthorized: access.commandAccess.authorized,
    InboundEventKind: inboundEventKind,
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
          log: (line) => runtime.log?.(line),
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
