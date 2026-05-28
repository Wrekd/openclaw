/**
 * Odoo Discuss Gateway
 *
 * Starts the gateway account for polling messages.
 */

import { createAccountStatusSink } from "openclaw/plugin-sdk/channel-lifecycle";
import { runStoppablePassiveMonitor } from "openclaw/plugin-sdk/extension-shared";
import type { ChannelAccountSnapshot } from "openclaw/plugin-sdk/status-helpers";
import type { CoreConfig } from "./accounts.js";
import { monitorOdooDiscuss } from "./monitor.js";
import type { ResolvedOdooDiscussAccount, RuntimeEnv } from "./types.js";

export async function startOdooDiscussGatewayAccount(ctx: {
  cfg: CoreConfig;
  accountId: string;
  account: ResolvedOdooDiscussAccount;
  runtime: RuntimeEnv;
  abortSignal: AbortSignal;
  setStatus: (next: ChannelAccountSnapshot) => void;
  log?: {
    info?: (message: string) => void;
    warn?: (message: string) => void;
    error?: (message: string) => void;
  };
}): Promise<void> {
  const account = ctx.account;
  const statusSink = createAccountStatusSink({
    accountId: ctx.accountId,
    setStatus: ctx.setStatus,
  });

  if (!account.configured) {
    throw new Error(
      `Odoo Discuss is not configured for account "${account.accountId}" (need url, db, user, password).`,
    );
  }

  ctx.log?.info?.(`[${account.accountId}] starting Odoo Discuss provider (${account.config.url})`);

  await runStoppablePassiveMonitor({
    abortSignal: ctx.abortSignal,
    start: async () =>
      await monitorOdooDiscuss({
        accountId: account.accountId,
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        statusSink,
      }),
  });
}
