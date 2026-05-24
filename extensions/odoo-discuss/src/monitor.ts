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

  // Authenticate and get initial state
  try {
    connectedUid = await client.authenticate();
    logger.info(
      `[${account.accountId}] authenticated to ${account.config.url} as uid=${connectedUid}`,
    );

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

    // Get initial last message ID to avoid processing old messages
    const initialMessages = await client.pollMessages();
    if (initialMessages.length > 0) {
      lastMessageId = Math.max(...initialMessages.map((m) => m.id));
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

  async function poll() {
    while (running && !opts.abortSignal?.aborted) {
      try {
        const messages = await client.pollMessages(lastMessageId);

        for (const msg of messages) {
          // Update last message ID
          if (msg.id > lastMessageId) {
            lastMessageId = msg.id;
          }

          // Skip messages from self
          const authorId = Array.isArray(msg.author_id) ? msg.author_id[0] : 0;
          if (authorId === connectedUid) {
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

          const inboundMessage = convertOdooMessage(msg, channelInfo.name, channelInfo.isGroup);

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
                await client.sendMessage(targetChannelId, text);
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

  // Handle abort signal
  opts.abortSignal?.addEventListener("abort", () => {
    running = false;
  });

  return {
    stop: () => {
      running = false;
      // Set presence to offline
      if (account.config.presenceEnabled !== false) {
        client.setPresence("offline").catch(() => {});
      }
    },
  };
}
