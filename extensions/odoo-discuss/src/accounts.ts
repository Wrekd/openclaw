/**
 * Odoo Discuss Account Resolution
 *
 * Handles account configuration and resolution.
 */

import type { OdooDiscussConfig, ResolvedOdooDiscussAccount } from "./types.js";

export const DEFAULT_ACCOUNT_ID = "default";

export interface CoreConfig {
  channels?: {
    "odoo-discuss"?: OdooDiscussConfig;
  };
}

/**
 * Resolve environment variable fallbacks for config
 */
function resolveConfigFromEnv(): Partial<OdooDiscussConfig> {
  return {
    url: process.env.ODOO_DISCUSS_URL || "",
    db: process.env.ODOO_DISCUSS_DB || "",
    user: process.env.ODOO_DISCUSS_USER || "",
    password: process.env.ODOO_DISCUSS_PASSWORD || "",
  };
}

/**
 * List all configured account IDs
 */
export function listOdooDiscussAccountIds(config: CoreConfig | undefined): string[] {
  if (config?.channels?.["odoo-discuss"]) {
    return [DEFAULT_ACCOUNT_ID];
  }

  // Check environment variables
  const envConfig = resolveConfigFromEnv();
  if (envConfig.url && envConfig.user) {
    return [DEFAULT_ACCOUNT_ID];
  }

  return [];
}

/**
 * Resolve the default account ID
 */
export function resolveDefaultAccountId(): string {
  return DEFAULT_ACCOUNT_ID;
}

/**
 * Resolve an Odoo Discuss account
 */
export function resolveOdooDiscussAccount(params: {
  cfg: CoreConfig;
  accountId?: string | null;
}): ResolvedOdooDiscussAccount {
  const { cfg, accountId = DEFAULT_ACCOUNT_ID } = params;
  const odooConfig = cfg?.channels?.["odoo-discuss"];
  const envConfig = resolveConfigFromEnv();

  const config: OdooDiscussConfig = {
    url: odooConfig?.url || envConfig.url || "",
    db: odooConfig?.db || envConfig.db || "",
    user: odooConfig?.user || envConfig.user || "",
    password: odooConfig?.password || envConfig.password || "",
    pollIntervalMs: odooConfig?.pollIntervalMs ?? 5000,
    defaultChannelId: odooConfig?.defaultChannelId,
    allowFrom: odooConfig?.allowFrom ?? [],
    dmPolicy: odooConfig?.dmPolicy ?? "allowlist",
    groupPolicy: odooConfig?.groupPolicy ?? "allowlist",
    allowedChannels: odooConfig?.allowedChannels ?? [],
    botName: odooConfig?.botName,
    presenceEnabled: odooConfig?.presenceEnabled ?? true,
  };

  const configured = Boolean(config.url && config.db && config.user && config.password);

  return {
    accountId: accountId || DEFAULT_ACCOUNT_ID,
    config,
    configured,
    enabled: configured,
  };
}

/**
 * Resolve account for a specific account ID
 */
export function resolveAccount(
  config: CoreConfig | undefined,
  accountId?: string | null,
): ResolvedOdooDiscussAccount {
  return resolveOdooDiscussAccount({
    cfg: config ?? {},
    accountId,
  });
}
