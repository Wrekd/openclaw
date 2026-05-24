/**
 * Odoo Discuss Runtime Store
 *
 * Manages the plugin runtime state.
 */

import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
import type { PluginRuntime } from "openclaw/plugin-sdk/runtime-store";

const {
  setRuntime: setOdooDiscussRuntime,
  clearRuntime: clearStoredOdooDiscussRuntime,
  getRuntime: getOdooDiscussRuntime,
} = createPluginRuntimeStore<PluginRuntime>({
  pluginId: "odoo-discuss",
  errorMessage: "Odoo Discuss runtime not initialized",
});

export { getOdooDiscussRuntime, setOdooDiscussRuntime };

export function clearOdooDiscussRuntime(): void {
  clearStoredOdooDiscussRuntime();
}
