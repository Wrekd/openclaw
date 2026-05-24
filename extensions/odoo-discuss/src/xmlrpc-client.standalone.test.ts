/**
 * Standalone Odoo XML-RPC Client Tests
 *
 * These tests verify the core XML-RPC functionality without plugin-sdk dependencies.
 * Run with: npx vitest run this-file.test.ts
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Inline the XML-RPC encoding/decoding for standalone testing
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

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

describe("XML-RPC Encoding", () => {
  it("should encode null", () => {
    expect(encodeValue(null)).toBe("<value><nil/></value>");
  });

  it("should encode boolean", () => {
    expect(encodeValue(true)).toBe("<value><boolean>1</boolean></value>");
    expect(encodeValue(false)).toBe("<value><boolean>0</boolean></value>");
  });

  it("should encode integer", () => {
    expect(encodeValue(42)).toBe("<value><int>42</int></value>");
    expect(encodeValue(-5)).toBe("<value><int>-5</int></value>");
  });

  it("should encode double", () => {
    expect(encodeValue(3.14)).toBe("<value><double>3.14</double></value>");
  });

  it("should encode string with escaping", () => {
    expect(encodeValue("hello")).toBe("<value><string>hello</string></value>");
    expect(encodeValue("<tag>&")).toBe("<value><string>&lt;tag&gt;&amp;</string></value>");
  });

  it("should encode array", () => {
    const result = encodeValue([1, "two"]);
    expect(result).toContain("<array><data>");
    expect(result).toContain("<int>1</int>");
    expect(result).toContain("<string>two</string>");
  });

  it("should encode struct", () => {
    const result = encodeValue({ name: "test", count: 5 });
    expect(result).toContain("<struct>");
    expect(result).toContain("<member><name>name</name>");
    expect(result).toContain("<string>test</string>");
    expect(result).toContain("<member><name>count</name>");
    expect(result).toContain("<int>5</int>");
  });
});

describe("XML-RPC Parsing", () => {
  it("should parse nil", () => {
    expect(parseValue("<value><nil/></value>")).toBe(null);
  });

  it("should parse boolean", () => {
    expect(parseValue("<value><boolean>1</boolean></value>")).toBe(true);
    expect(parseValue("<value><boolean>0</boolean></value>")).toBe(false);
  });

  it("should parse integer", () => {
    expect(parseValue("<value><int>42</int></value>")).toBe(42);
    expect(parseValue("<value><i4>-10</i4></value>")).toBe(-10);
  });

  it("should parse double", () => {
    expect(parseValue("<value><double>3.14</double></value>")).toBe(3.14);
  });

  it("should parse string with unescaping", () => {
    expect(parseValue("<value><string>hello</string></value>")).toBe("hello");
    expect(parseValue("<value><string>&lt;tag&gt;</string></value>")).toBe("<tag>");
  });

  it("should parse array", () => {
    const result = parseValue(
      "<value><array><data><value><int>1</int></value><value><int>2</int></value></data></array></value>",
    );
    expect(result).toEqual([1, 2]);
  });

  it("should parse struct", () => {
    const result = parseValue(
      "<value><struct><member><name>id</name><value><int>5</int></value></member><member><name>name</name><value><string>Test</string></value></member></struct></value>",
    );
    expect(result).toEqual({ id: 5, name: "Test" });
  });
});

describe("stripHtml", () => {
  it("should strip HTML tags", () => {
    expect(stripHtml("<p>Hello <b>World</b></p>")).toBe("Hello World");
  });

  it("should convert br tags to newlines", () => {
    expect(stripHtml("Line 1<br>Line 2<br/>Line 3")).toBe("Line 1\nLine 2\nLine 3");
  });

  it("should decode HTML entities", () => {
    // Note: trailing space from &nbsp; is trimmed
    expect(stripHtml("&lt;script&gt;&amp;&nbsp;")).toBe("<script>&");
  });

  it("should handle p tags as paragraphs", () => {
    expect(stripHtml("<p>Para 1</p><p>Para 2</p>")).toBe("Para 1\nPara 2");
  });

  it("should handle complex HTML from Odoo", () => {
    const odooHtml = "<p>Hello!</p><p>This is a <strong>test</strong> message.</p>";
    expect(stripHtml(odooHtml)).toBe("Hello!\nThis is a test message.");
  });
});

describe("Account Resolution", () => {
  const DEFAULT_ACCOUNT_ID = "default";

  interface OdooDiscussConfig {
    url: string;
    db: string;
    user: string;
    password: string;
    pollIntervalMs?: number;
    dmPolicy?: string;
  }

  interface CoreConfig {
    channels?: {
      "odoo-discuss"?: OdooDiscussConfig;
    };
  }

  function resolveOdooDiscussAccount(params: { cfg: CoreConfig; accountId?: string | null }) {
    const { cfg, accountId = DEFAULT_ACCOUNT_ID } = params;
    const odooConfig = cfg?.channels?.["odoo-discuss"];
    const envUrl = process.env.ODOO_URL || "";
    const envDb = process.env.ODOO_DB || "";
    const envUser = process.env.ODOO_USER || "";
    const envPassword = process.env.ODOO_PASSWORD || "";

    const config: OdooDiscussConfig = {
      url: odooConfig?.url || envUrl,
      db: odooConfig?.db || envDb,
      user: odooConfig?.user || envUser,
      password: odooConfig?.password || envPassword,
      pollIntervalMs: odooConfig?.pollIntervalMs ?? 5000,
      dmPolicy: odooConfig?.dmPolicy ?? "allowlist",
    };

    const configured = Boolean(config.url && config.db && config.user && config.password);

    return {
      accountId: accountId || DEFAULT_ACCOUNT_ID,
      config,
      configured,
      enabled: configured,
    };
  }

  it("should resolve from config", () => {
    const cfg: CoreConfig = {
      channels: {
        "odoo-discuss": {
          url: "https://erp.example.com",
          db: "test_db",
          user: "admin@example.com",
          password: "api_key_123",
        },
      },
    };

    const account = resolveOdooDiscussAccount({ cfg });

    expect(account.accountId).toBe("default");
    expect(account.configured).toBe(true);
    expect(account.config.url).toBe("https://erp.example.com");
    expect(account.config.db).toBe("test_db");
  });

  it("should use defaults for optional fields", () => {
    const cfg: CoreConfig = {
      channels: {
        "odoo-discuss": {
          url: "https://erp.example.com",
          db: "test",
          user: "admin",
          password: "secret",
        },
      },
    };

    const account = resolveOdooDiscussAccount({ cfg });

    expect(account.config.pollIntervalMs).toBe(5000);
    expect(account.config.dmPolicy).toBe("allowlist");
  });

  it("should not be configured when missing required fields", () => {
    const account = resolveOdooDiscussAccount({ cfg: {} });

    expect(account.configured).toBe(false);
    expect(account.enabled).toBe(false);
  });
});

describe("Session Key Generation", () => {
  it("should generate consistent session keys", () => {
    const generateSessionKey = (channel: string, accountId: string, peerId: string) =>
      `${channel}:${accountId}:${peerId}`;

    const key1 = generateSessionKey("odoo-discuss", "default", "channel-1");
    const key2 = generateSessionKey("odoo-discuss", "default", "channel-1");
    const key3 = generateSessionKey("odoo-discuss", "default", "channel-2");

    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
  });
});

describe("Live Odoo Connection Test", () => {
  it.skip("should authenticate to real Odoo server", async () => {
    // This test requires actual Odoo credentials
    const url = process.env.ODOO_URL || "https://erp.wrekd.com";
    const db = process.env.ODOO_DB || "WREKD";
    const user = process.env.ODOO_USER || "kaveman@wrekd.com";
    const password = process.env.ODOO_PASSWORD || "";

    if (!password) {
      console.log("Skipping live test - no ODOO_PASSWORD set");
      return;
    }

    const body = `<?xml version="1.0"?><methodCall><methodName>authenticate</methodName><params><param><value><string>${db}</string></value></param><param><value><string>${user}</string></value></param><param><value><string>${password}</string></value></param><param><value><struct></struct></value></param></params></methodCall>`;

    const response = await fetch(`${url}/xmlrpc/2/common`, {
      method: "POST",
      headers: { "Content-Type": "text/xml" },
      body,
    });

    const xml = await response.text();
    console.log("Auth response:", xml);

    expect(response.ok).toBe(true);
    expect(xml).toContain("<int>");
  });
});
