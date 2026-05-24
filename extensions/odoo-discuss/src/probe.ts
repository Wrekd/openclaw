/**
 * Odoo Discuss Probe
 *
 * Tests connection and authentication to Odoo.
 */

import { resolveOdooDiscussAccount, type CoreConfig } from "./accounts.js";
import type { OdooDiscussProbe } from "./types.js";
import { testConnection } from "./xmlrpc-client.js";

export async function probeOdooDiscuss(
  cfg: CoreConfig,
  options?: { accountId?: string; timeoutMs?: number },
): Promise<OdooDiscussProbe> {
  const account = resolveOdooDiscussAccount({
    cfg,
    accountId: options?.accountId,
  });

  if (!account.configured) {
    return {
      kind: "error",
      error: "Odoo Discuss is not configured",
    };
  }

  try {
    const timeoutMs = options?.timeoutMs ?? 10000;

    const result = await Promise.race([
      testConnection(account.config),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Connection timeout")), timeoutMs),
      ),
    ]);

    return {
      kind: "connected",
      uid: result.uid,
      serverVersion: result.serverVersion,
    };
  } catch (error) {
    return {
      kind: "error",
      error: String(error),
    };
  }
}
