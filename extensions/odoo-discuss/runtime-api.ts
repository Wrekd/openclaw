// Keep the bundled runtime entry narrow so generic runtime activation does not
// import the broad Odoo Discuss API barrel just to install runtime state.
export { setOdooDiscussRuntime } from "./src/runtime.js";
