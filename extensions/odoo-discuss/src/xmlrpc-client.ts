/**
 * Odoo XML-RPC Client
 *
 * Handles authentication and API calls to Odoo via XML-RPC.
 * Supports both password and API key authentication (Odoo 14+).
 */

import type { OdooXmlRpcClient, OdooChannel, OdooMessage, OdooDiscussConfig } from "./types.js";

/**
 * Encode a value as XML-RPC
 */
function encodeValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "<value><nil/></value>";
  }
  if (typeof value === "boolean") {
    return `<value><boolean>${value ? "1" : "0"}</boolean></value>`;
  }
  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      return `<value><int>${value}</int></value>`;
    }
    return `<value><double>${value}</double></value>`;
  }
  if (typeof value === "string") {
    const escaped = value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<value><string>${escaped}</string></value>`;
  }
  if (Array.isArray(value)) {
    const items = value.map((v) => encodeValue(v)).join("");
    return `<value><array><data>${items}</data></array></value>`;
  }
  if (typeof value === "object") {
    const members = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `<member><name>${k}</name>${encodeValue(v)}</member>`)
      .join("");
    return `<value><struct>${members}</struct></value>`;
  }
  return `<value><string>${String(value)}</string></value>`;
}

/**
 * Build XML-RPC request body
 */
function buildXmlRpcRequest(method: string, params: unknown[]): string {
  const paramsXml = params.map((p) => `<param>${encodeValue(p)}</param>`).join("");
  return `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params>${paramsXml}</params></methodCall>`;
}

/**
 * Parse XML-RPC response value
 */
function parseValue(xml: string): unknown {
  // Strip outer <value> tags if present
  let inner = xml.trim();
  const outerValueMatch = inner.match(/^<value>([\s\S]*)<\/value>$/);
  if (outerValueMatch) {
    inner = outerValueMatch[1].trim();
  }

  // Check for nil
  if (inner === "<nil/>" || inner === "<nil></nil>") {
    return null;
  }

  // Boolean
  const boolMatch = inner.match(/^<boolean>([01])<\/boolean>$/);
  if (boolMatch) {
    return boolMatch[1] === "1";
  }

  // Integer
  const intMatch = inner.match(/^<(?:int|i4)>(-?\d+)<\/(?:int|i4)>$/);
  if (intMatch) {
    return parseInt(intMatch[1], 10);
  }

  // Double
  const doubleMatch = inner.match(/^<double>(-?[\d.]+)<\/double>$/);
  if (doubleMatch) {
    return parseFloat(doubleMatch[1]);
  }

  // String
  const stringMatch = inner.match(/^<string>([\s\S]*?)<\/string>$/);
  if (stringMatch) {
    return stringMatch[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  }

  // Array - need to carefully extract each value element
  if (inner.startsWith("<array>")) {
    const dataMatch = inner.match(/<array>\s*<data>([\s\S]*)<\/data>\s*<\/array>/);
    if (dataMatch) {
      const values: unknown[] = [];
      const dataContent = dataMatch[1];
      // Find each <value>...</value> at the top level
      let depth = 0;
      let start = -1;
      for (let i = 0; i < dataContent.length; i++) {
        if (dataContent.slice(i, i + 7) === "<value>") {
          if (depth === 0) start = i;
          depth++;
        } else if (dataContent.slice(i, i + 8) === "</value>") {
          depth--;
          if (depth === 0 && start >= 0) {
            const valueXml = dataContent.slice(start, i + 8);
            values.push(parseValue(valueXml));
            start = -1;
          }
        }
      }
      return values;
    }
  }

  // Struct
  if (inner.startsWith("<struct>")) {
    const result: Record<string, unknown> = {};
    const structContent = inner.slice(8, inner.lastIndexOf("</struct>"));
    // Find each member
    const memberRegex =
      /<member>\s*<name>([^<]+)<\/name>\s*<value>([\s\S]*?)<\/value>\s*<\/member>/g;
    let match;
    while ((match = memberRegex.exec(structContent)) !== null) {
      result[match[1]] = parseValue(`<value>${match[2]}</value>`);
    }
    return result;
  }

  // Bare value (no type tag - treat as string)
  if (!inner.startsWith("<")) {
    return inner;
  }

  return null;
}

/**
 * Parse XML-RPC response
 */
function parseXmlRpcResponse(xml: string): unknown {
  // Check for fault
  const faultMatch = xml.match(/<fault>\s*<value>([\s\S]*?)<\/value>\s*<\/fault>/);
  if (faultMatch) {
    const fault = parseValue(`<value>${faultMatch[1]}</value>`) as Record<string, unknown>;
    throw new Error(`XML-RPC Fault ${fault.faultCode}: ${fault.faultString}`);
  }

  // Get params
  const paramMatch = xml.match(
    /<params>\s*<param>\s*<value>([\s\S]*?)<\/value>\s*<\/param>\s*<\/params>/,
  );
  if (paramMatch) {
    return parseValue(`<value>${paramMatch[1]}</value>`);
  }

  throw new Error("Invalid XML-RPC response");
}

/**
 * Create an Odoo XML-RPC client
 */
export function createOdooXmlRpcClient(config: OdooDiscussConfig): OdooXmlRpcClient {
  const { url, db, user, password } = config;
  let uid: number | null = null;

  async function xmlRpcCall(endpoint: string, method: string, params: unknown[]): Promise<unknown> {
    const fullUrl = `${url.replace(/\/$/, "")}/xmlrpc/2/${endpoint}`;
    const body = buildXmlRpcRequest(method, params);

    const response = await fetch(fullUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml",
      },
      body,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const xml = await response.text();
    return parseXmlRpcResponse(xml);
  }

  async function authenticate(): Promise<number> {
    const result = await xmlRpcCall("common", "authenticate", [db, user, password, {}]);
    if (typeof result !== "number" || result === 0) {
      throw new Error("Authentication failed");
    }
    uid = result;
    return uid;
  }

  async function call<T>(
    model: string,
    method: string,
    args: unknown[],
    kwargs?: Record<string, unknown>,
  ): Promise<T> {
    if (uid === null) {
      await authenticate();
    }
    return (await xmlRpcCall("object", "execute_kw", [
      db,
      uid,
      password,
      model,
      method,
      args,
      kwargs ?? {},
    ])) as T;
  }

  async function searchRead<T>(
    model: string,
    domain: unknown[],
    fields: string[],
    options?: { limit?: number; offset?: number; order?: string },
  ): Promise<T[]> {
    return await call<T[]>(model, "search_read", [domain], {
      fields,
      limit: options?.limit,
      offset: options?.offset,
      order: options?.order,
    });
  }

  async function setPresence(status: "online" | "offline"): Promise<void> {
    if (uid === null) {
      await authenticate();
    }
    // Odoo 19 doesn't expose update_presence over XML-RPC, so we write the
    // mail.presence row directly. Try modern (mail.presence) then legacy (bus.presence).
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    const vals: Record<string, unknown> = {
      status,
      last_poll: now,
      last_presence: now,
    };
    for (const model of ["mail.presence", "bus.presence"]) {
      try {
        const ids = await call<number[]>(model, "search", [[["user_id", "=", uid]]]);
        if (ids.length > 0) {
          await call(model, "write", [ids, vals]);
        } else {
          await call(model, "create", [{ ...vals, user_id: uid }]);
        }
        return;
      } catch {
        // try next model
      }
    }
    throw new Error("set presence failed: no compatible presence model");
  }

  async function getChannels(): Promise<OdooChannel[]> {
    // Get channels where the user is a member
    return await searchRead<OdooChannel>(
      "discuss.channel",
      [["is_member", "=", true]],
      ["id", "name", "channel_type", "description", "member_count"],
      { limit: 100, order: "name" },
    );
  }

  async function getMessages(channelId: number, lastMessageId?: number): Promise<OdooMessage[]> {
    const domain: unknown[] = [
      ["res_id", "=", channelId],
      ["model", "=", "discuss.channel"],
    ];
    if (lastMessageId) {
      domain.push(["id", ">", lastMessageId]);
    }

    return await searchRead<OdooMessage>(
      "mail.message",
      domain,
      ["id", "body", "author_id", "date", "message_type", "record_name", "partner_ids"],
      { limit: 50, order: "id asc" },
    );
  }

  async function sendMessage(channelId: number, body: string): Promise<number> {
    // Use message_post on the channel
    const messageId = await call<number>("discuss.channel", "message_post", [[channelId]], {
      body,
      message_type: "comment",
      subtype_xmlid: "mail.mt_comment",
    });
    return messageId;
  }

  async function pollMessages(lastMessageId?: number): Promise<OdooMessage[]> {
    // Get all new messages across all channels the user is member of
    const domain: unknown[] = [
      ["model", "=", "discuss.channel"],
      ["message_type", "in", ["comment", "notification"]],
    ];
    if (lastMessageId) {
      domain.push(["id", ">", lastMessageId]);
    }

    return await searchRead<OdooMessage>(
      "mail.message",
      domain,
      [
        "id",
        "body",
        "author_id",
        "date",
        "message_type",
        "record_name",
        "res_id",
        "partner_ids",
        "parent_id",
      ],
      { limit: 100, order: "id asc" },
    );
  }

  return {
    authenticate,
    call,
    searchRead,
    setPresence,
    getChannels,
    getMessages,
    sendMessage,
    pollMessages,
  };
}

/**
 * Strip HTML tags from Odoo message body
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n+$/, "");
}

/**
 * Test connection and return server info
 */
export async function testConnection(config: OdooDiscussConfig): Promise<{
  uid: number;
  serverVersion: string;
}> {
  const fullUrl = `${config.url.replace(/\/$/, "")}/xmlrpc/2/common`;
  const body = buildXmlRpcRequest("version", []);

  const response = await fetch(fullUrl, {
    method: "POST",
    headers: { "Content-Type": "text/xml" },
    body,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const xml = await response.text();
  const versionInfo = parseXmlRpcResponse(xml) as Record<string, unknown>;
  const serverVersion = (versionInfo.server_version as string) ?? "unknown";

  // Authenticate
  const client = createOdooXmlRpcClient(config);
  const uid = await client.authenticate();

  return { uid, serverVersion };
}
