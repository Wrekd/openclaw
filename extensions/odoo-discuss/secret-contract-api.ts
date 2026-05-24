import type { SecretTargetRegistryEntry } from "openclaw/plugin-sdk/channel-secret-basic-runtime";

export const secretTargetRegistryEntries: SecretTargetRegistryEntry[] = [
  {
    id: "channels.odoo-discuss.password",
    targetType: "channels.odoo-discuss.password",
    configFile: "openclaw.json",
    pathPattern: "channels.odoo-discuss.password",
    secretShape: "secret_input",
    expectedResolvedValue: "string",
    includeInPlan: true,
    includeInConfigure: true,
    includeInAudit: true,
  },
];

export function collectRuntimeConfigAssignments() {
  return [];
}

export const channelSecrets = {
  secretTargetRegistryEntries,
  collectRuntimeConfigAssignments,
};
