/**
 * Odoo Discuss Monitor
 *
 * Polls for new messages and handles them via the inbound handler.
 */

import { resolveLoggerBackedRuntime } from "openclaw/plugin-sdk/extension-shared";
import { resolveOdooDiscussAccount, type CoreConfig } from "./accounts.js";
import { handleOdooDiscussInbound } from "./inbound.js";
import { getOdooDiscussRuntime } from "./runtime.js";
import type { OdooInboundMessage, OdooMessage, OdooXmlRpcClient, RuntimeEnv } from "./types.js";
import { createOdooXmlRpcClient, stripHtml } from "./xmlrpc-client.js";

export interface OdooMonitorOptions {
  accountId?: string;
  config?: CoreConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
  onMessage?: (message: OdooInboundMessage, client: OdooXmlRpcClient) => void | Promise<void>;
}

/**
 * Convert an Odoo message to our inbound format
 */
function convertOdooMessage(
  msg: OdooMessage,
  channelName: string,
  isGroup: boolean,
  replyToBot: boolean,
): OdooInboundMessage {
  const authorId = Array.isArray(msg.author_id) ? msg.author_id[0] : 0;
  const authorName = Array.isArray(msg.author_id) ? msg.author_id[1] : "Unknown";

  return {
    messageId: String(msg.id),
    channelId: msg.res_id ?? 0,
    channelName,
    isGroup,
    senderId: authorId,
    senderName: authorName,
    body: stripHtml(msg.body || ""),
    timestamp: msg.date ? new Date(msg.date).getTime() : Date.now(),
    replyToBot,
  };
}

/**
 * Monitor Odoo Discuss for new messages
 */
export async function monitorOdooDiscuss(opts: OdooMonitorOptions): Promise<{ stop: () => void }> {
  const core = getOdooDiscussRuntime();
  const cfg = opts.config ?? (core.config.current() as CoreConfig);
  const account = resolveOdooDiscussAccount({
    cfg,
    accountId: opts.accountId,
  });

  const runtime: RuntimeEnv = resolveLoggerBackedRuntime(
    opts.runtime,
    core.logging.getChildLogger(),
  );

  if (!account.configured) {
    throw new Error(
      `Odoo Discuss is not configured for account "${account.accountId}" (need url, db, user, password).`,
    );
  }

  const logger = core.logging.getChildLogger({
    channel: "odoo-discuss",
    accountId: account.accountId,
  });

  const client = createOdooXmlRpcClient(account.config);
  let running = true;
  let lastMessageId = 0;
  let connectedUid: number | null = null;
  let connectedPartnerId: number | null = null;

  // Authenticate and get initial state
  try {
    connectedUid = await client.authenticate();
    logger.info(
      `[${account.accountId}] authenticated to ${account.config.url} as uid=${connectedUid}`,
    );

    // Resolve our partner_id so we can filter out our own messages (author_id is a res.partner ref, not res.users).
    // This is REQUIRED: without it we'd dispatch our own replies back through the agent and loop forever.
    const users = await client.searchRead<{ id: number; partner_id: [number, string] | false }>(
      "res.users",
      [["id", "=", connectedUid]],
      ["partner_id"],
      { limit: 1 },
    );
    if (users.length > 0 && Array.isArray(users[0].partner_id)) {
      connectedPartnerId = users[0].partner_id[0];
      logger.info(`[${account.accountId}] resolved partner_id=${connectedPartnerId}`);
    }
    if (connectedPartnerId === null) {
      throw new Error(
        `[${account.accountId}] could not resolve partner_id for uid=${connectedUid}; refusing to start to avoid self-message loop`,
      );
    }

    // Set presence to online
    if (account.config.presenceEnabled !== false) {
      try {
        await client.setPresence("online");
        logger.info(`[${account.accountId}] presence set to online`);
      } catch (error) {
        logger.warn(`[${account.accountId}] failed to set presence: ${String(error)}`);
      }
    }

    // Get channel list
    const channels = await client.getChannels();
    logger.info(`[${account.accountId}] monitoring ${channels.length} channels`);

    // Get the current latest message ID so we only process messages that arrive AFTER startup.
    // Previously polled without lastMessageId (ASC limit 100) which returned the OLDEST 100 and
    // started us replaying days of history.
    const latest = await client.searchRead<{ id: number }>(
      "mail.message",
      [["model", "=", "discuss.channel"]],
      ["id"],
      { limit: 1, order: "id desc" },
    );
    if (latest.length > 0) {
      lastMessageId = latest[0].id;
      logger.info(`[${account.accountId}] starting from message ID ${lastMessageId}`);
    }
  } catch (error) {
    logger.error(`[${account.accountId}] failed to initialize: ${String(error)}`);
    throw error;
  }

  // Build channel lookup map
  const channelMap = new Map<number, { name: string; isGroup: boolean }>();
  const channels = await client.getChannels();
  for (const ch of channels) {
    channelMap.set(ch.id, {
      name: ch.name,
      isGroup: ch.channel_type !== "chat",
    });
  }

  // Polling loop
  const pollIntervalMs = account.config.pollIntervalMs ?? 5000;

  // Track recently sent bot message IDs so we can detect when a user replies
  // to one of our messages (implicit mention via parent_id).
  const sentMessageIds = new Set<number>();
  const SENT_HISTORY_LIMIT = 500;
  function recordSentMessageId(id: number) {
    sentMessageIds.add(id);
    if (sentMessageIds.size > SENT_HISTORY_LIMIT) {
      const oldest = sentMessageIds.values().next().value;
      if (oldest !== undefined) sentMessageIds.delete(oldest);
    }
  }

  async function poll() {
    while (running && !opts.abortSignal?.aborted) {
      try {
        const messages = await client.pollMessages(lastMessageId);

        for (const msg of messages) {
          // Update last message ID
          if (msg.id > lastMessageId) {
            lastMessageId = msg.id;
          }

          // Skip messages from self (author_id is a res.partner ref)
          const authorId = Array.isArray(msg.author_id) ? msg.author_id[0] : 0;
          if (connectedPartnerId !== null && authorId === connectedPartnerId) {
            continue;
          }

          // Skip non-comment messages (system notifications, etc.)
          if (msg.message_type !== "comment") {
            continue;
          }

          // Get channel info
          const channelId = msg.res_id ?? 0;
          const channelInfo = channelMap.get(channelId) ?? {
            name: msg.record_name ?? `Channel ${channelId}`,
            isGroup: true,
          };

          // Detect reply-to-bot via parent_id pointing at a message we sent.
          const parentId = Array.isArray(msg.parent_id) ? msg.parent_id[0] : 0;
          const replyToBot = parentId > 0 && sentMessageIds.has(parentId);

          const inboundMessage = convertOdooMessage(
            msg,
            channelInfo.name,
            channelInfo.isGroup,
            replyToBot,
          );

          // Skip empty messages
          if (!inboundMessage.body.trim()) {
            continue;
          }

          core.channel.activity.record({
            channel: "odoo-discuss",
            accountId: account.accountId,
            direction: "inbound",
            at: inboundMessage.timestamp,
          });

          if (opts.onMessage) {
            await opts.onMessage(inboundMessage, client);
          } else {
            await handleOdooDiscussInbound({
              message: inboundMessage,
              account,
              config: cfg,
              runtime,
              sendReply: async (targetChannelId, text) => {
                const sentId = await client.sendMessage(targetChannelId, text);
                if (typeof sentId === "number" && sentId > 0) {
                  recordSentMessageId(sentId);
                }
                opts.statusSink?.({ lastOutboundAt: Date.now() });
                core.channel.activity.record({
                  channel: "odoo-discuss",
                  accountId: account.accountId,
                  direction: "outbound",
                });
              },
              statusSink: opts.statusSink,
            });
          }
        }
      } catch (error) {
        logger.error(`[${account.accountId}] poll error: ${String(error)}`);
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  // Start polling
  poll().catch((error) => {
    logger.error(`[${account.accountId}] polling stopped with error: ${String(error)}`);
  });

  // Presence heartbeat (Odoo expires presence after ~60s of inactivity)
  let presenceTimer: ReturnType<typeof setInterval> | null = null;
  if (account.config.presenceEnabled !== false) {
    presenceTimer = setInterval(() => {
      client.setPresence("online").catch((error) => {
        logger.warn(`[${account.accountId}] presence heartbeat failed: ${String(error)}`);
      });
    }, 30_000);
  }

  // Handle abort signal
  opts.abortSignal?.addEventListener("abort", () => {
    running = false;
  });

  return {
    stop: () => {
      running = false;
      if (presenceTimer) {
        clearInterval(presenceTimer);
        presenceTimer = null;
      }
      // Set presence to offline
      if (account.config.presenceEnabled !== false) {
        client.setPresence("offline").catch(() => {});
      }
    },
  };
}
