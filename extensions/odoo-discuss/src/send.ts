/**
 * Odoo Discuss Send Message
 *
 * Handles sending messages back to Odoo Discuss channels.
 */

import { resolveOdooDiscussAccount, type CoreConfig } from "./accounts.js";
import { getOdooDiscussRuntime } from "./runtime.js";
import { createOdooXmlRpcClient } from "./xmlrpc-client.js";

export interface SendMessageOptions {
  cfg: CoreConfig;
  accountId?: string;
  replyTo?: string;
}

/**
 * Send a message to an Odoo Discuss channel
 */
export async function sendMessageOdooDiscuss(
  channelId: number,
  text: string,
  options: SendMessageOptions,
): Promise<number> {
  const account = resolveOdooDiscussAccount({
    cfg: options.cfg,
    accountId: options.accountId,
  });

  if (!account.configured) {
    throw new Error(`Odoo Discuss account "${account.accountId}" is not configured`);
  }

  const client = createOdooXmlRpcClient(account.config);

  try {
    const messageId = await client.sendMessage(channelId, text);

    // Record outbound activity
    try {
      const core = getOdooDiscussRuntime();
      core.channel.activity.record({
        channel: "odoo-discuss",
        accountId: account.accountId,
        direction: "outbound",
      });
    } catch {
      // Ignore activity recording errors
    }

    return messageId;
  } catch (error) {
    throw new Error(
      `Failed to send message to Odoo Discuss channel ${channelId}: ${String(error)}`,
    );
  }
}

/**
 * Send a message to an Odoo Discuss channel by name or ID
 */
export async function sendMessageToChannel(
  target: string | number,
  text: string,
  options: SendMessageOptions,
): Promise<number> {
  const account = resolveOdooDiscussAccount({
    cfg: options.cfg,
    accountId: options.accountId,
  });

  if (!account.configured) {
    throw new Error(`Odoo Discuss account "${account.accountId}" is not configured`);
  }

  const client = createOdooXmlRpcClient(account.config);
  let channelId: number;

  if (typeof target === "number") {
    channelId = target;
  } else {
    // Try to find channel by name
    const channels = await client.getChannels();
    const channel = channels.find(
      (c) => c.name.toLowerCase() === target.toLowerCase() || String(c.id) === target,
    );
    if (!channel) {
      throw new Error(`Odoo Discuss channel "${target}" not found`);
    }
    channelId = channel.id;
  }

  try {
    const messageId = await client.sendMessage(channelId, text);
    try {
      const core = getOdooDiscussRuntime();
      core.channel.activity.record({
        channel: "odoo-discuss",
        accountId: account.accountId,
        direction: "outbound",
      });
    } catch {
      // Ignore activity recording errors
    }
    return messageId;
  } catch (error) {
    throw new Error(
      `Failed to send message to Odoo Discuss channel ${channelId}: ${String(error)}`,
    );
  }
}
