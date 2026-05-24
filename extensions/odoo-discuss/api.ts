/**
 * Odoo Discuss Channel Public API
 *
 * Use this module to interact with Odoo Discuss from other extensions or tools.
 */

export { odooDiscussPlugin } from "./src/channel.js";
export { createOdooXmlRpcClient, testConnection, stripHtml } from "./src/xmlrpc-client.js";
export { sendMessageOdooDiscuss, sendMessageToChannel } from "./src/send.js";
export { monitorOdooDiscuss } from "./src/monitor.js";
export { probeOdooDiscuss } from "./src/probe.js";
export {
  resolveOdooDiscussAccount,
  listOdooDiscussAccountIds,
  resolveDefaultAccountId,
  DEFAULT_ACCOUNT_ID,
  type CoreConfig,
} from "./src/accounts.js";
export {
  getOdooDiscussRuntime,
  setOdooDiscussRuntime,
  clearOdooDiscussRuntime,
} from "./src/runtime.js";
export type {
  OdooDiscussConfig,
  ResolvedOdooDiscussAccount,
  OdooDiscussProbe,
  OdooMessage,
  OdooChannel,
  OdooInboundMessage,
  OdooXmlRpcClient,
} from "./src/types.js";
