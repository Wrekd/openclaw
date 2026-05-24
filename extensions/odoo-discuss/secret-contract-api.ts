import type { ChannelSecretsAdapter } from "openclaw/plugin-sdk/channel-secret-runtime";

export const channelSecrets: ChannelSecretsAdapter = {
  resolveTargets: () => [
    {
      kind: "env",
      key: "ODOO_URL",
      label: "Odoo URL",
      description: "Base URL for Odoo instance (e.g., https://erp.example.com)",
    },
    {
      kind: "env",
      key: "ODOO_DB",
      label: "Odoo Database",
      description: "Database name to connect to",
    },
    {
      kind: "env",
      key: "ODOO_USER",
      label: "Odoo User",
      description: "Username or email for authentication",
    },
    {
      kind: "env",
      key: "ODOO_PASSWORD",
      label: "Odoo Password",
      description: "Password or API key",
      secret: true,
    },
  ],
  collectRuntimeConfigAssignments: () => [],
};
