/**
 * Odoo Discuss Channel Plugin Tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock the runtime
vi.mock("./runtime.js", () => ({
  getOdooDiscussRuntime: () => ({
    channel: {
      activity: {
        record: vi.fn(),
      },
    },
  }),
}));

// Import after mocks
const { odooDiscussPlugin } = await import("./channel.js");

describe("odooDiscussPlugin", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("meta", () => {
    it("should have correct channel ID", () => {
      expect(odooDiscussPlugin.id).toBe("odoo-discuss");
    });

    it("should have correct metadata", () => {
      const meta = odooDiscussPlugin.meta;
      expect(meta.label).toBe("Odoo Discuss");
      expect(meta.selectionLabel).toBe("Odoo Discuss (ERP Chat)");
      expect(meta.blurb).toContain("Odoo");
    });
  });

  describe("capabilities", () => {
    it("should support direct and group chats", () => {
      expect(odooDiscussPlugin.capabilities.chatTypes).toContain("direct");
      expect(odooDiscussPlugin.capabilities.chatTypes).toContain("group");
    });

    it("should not support media directly", () => {
      expect(odooDiscussPlugin.capabilities.media).toBe(false);
    });

    it("should not support streaming", () => {
      expect(odooDiscussPlugin.capabilities.blockStreaming).toBe(false);
    });
  });

  describe("config", () => {
    it("should check configured state via env vars", () => {
      const hasConfiguredState = odooDiscussPlugin.config.hasConfiguredState;
      expect(typeof hasConfiguredState).toBe("function");

      // No env vars
      expect(hasConfiguredState?.({ env: {} })).toBe(false);

      // With env vars
      expect(
        hasConfiguredState?.({
          env: {
            ODOO_URL: "https://erp.example.com",
            ODOO_USER: "admin",
          },
        }),
      ).toBe(true);
    });

    it("should resolve account configuration", () => {
      const cfg = {
        channels: {
          "odoo-discuss": {
            url: "https://erp.example.com",
            db: "test",
            user: "admin",
            password: "secret",
          },
        },
      };

      const account = odooDiscussPlugin.config.resolveAccount(cfg, "default");
      expect(account).toBeDefined();
      expect(account?.config.url).toBe("https://erp.example.com");
    });

    it("should list account IDs", () => {
      const cfg = {
        channels: {
          "odoo-discuss": {
            url: "https://erp.example.com",
            db: "test",
            user: "admin",
            password: "secret",
          },
        },
      };

      const ids = odooDiscussPlugin.config.listAccountIds(cfg);
      expect(ids).toContain("default");
    });
  });

  describe("messaging", () => {
    it("should normalize targets", () => {
      const normalize = odooDiscussPlugin.messaging?.normalizeTarget;
      expect(normalize).toBeDefined();

      expect(normalize?.("odoo-discuss:123")).toBe("123");
      expect(normalize?.("odoo:456")).toBe("456");
      expect(normalize?.("789")).toBe("789");
      expect(normalize?.("  123  ")).toBe("123");
    });

    it("should identify valid target IDs", () => {
      const looksLikeId = odooDiscussPlugin.messaging?.targetResolver?.looksLikeId;
      expect(looksLikeId).toBeDefined();

      expect(looksLikeId?.("123")).toBe(true);
      expect(looksLikeId?.("odoo:456")).toBe(true);
      expect(looksLikeId?.("odoo-discuss:789")).toBe(true);
      expect(looksLikeId?.("")).toBe(false);
    });
  });

  describe("security", () => {
    it("should have pairing config", () => {
      expect(odooDiscussPlugin.pairing).toBeDefined();
      expect(odooDiscussPlugin.pairing?.text?.idLabel).toBe("odooUserId");
    });

    it("should resolve DM policy", () => {
      const cfg = {
        channels: {
          "odoo-discuss": {
            url: "https://erp.example.com",
            db: "test",
            user: "admin",
            password: "secret",
            dmPolicy: "open" as const,
          },
        },
      };

      const account = odooDiscussPlugin.config.resolveAccount(cfg, "default");
      expect(account?.config.dmPolicy).toBe("open");
    });
  });

  describe("outbound", () => {
    it("should have gateway delivery mode", () => {
      expect(odooDiscussPlugin.outbound?.deliveryMode).toBe("gateway");
    });

    it("should have appropriate text chunk limit", () => {
      expect(odooDiscussPlugin.outbound?.textChunkLimit).toBeGreaterThan(0);
    });

    it("should send text messages", async () => {
      // Mock authenticate
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          '<?xml version="1.0"?><methodResponse><params><param><value><int>5</int></value></param></params></methodResponse>',
      });
      // Mock message_post
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          '<?xml version="1.0"?><methodResponse><params><param><value><int>123</int></value></param></params></methodResponse>',
      });

      const cfg = {
        channels: {
          "odoo-discuss": {
            url: "https://erp.example.com",
            db: "test",
            user: "admin",
            password: "secret",
          },
        },
      };

      const result = await odooDiscussPlugin.outbound?.sendText?.({
        cfg,
        to: "1",
        text: "Hello from test!",
        accountId: "default",
      });

      expect(result).toBeDefined();
      expect(result?.messageId).toBe("123");
    });

    it("should reject invalid channel IDs", async () => {
      const cfg = {
        channels: {
          "odoo-discuss": {
            url: "https://erp.example.com",
            db: "test",
            user: "admin",
            password: "secret",
          },
        },
      };

      await expect(
        odooDiscussPlugin.outbound?.sendText?.({
          cfg,
          to: "not-a-number",
          text: "Hello",
          accountId: "default",
        }),
      ).rejects.toThrow(/Invalid/);
    });
  });

  describe("status", () => {
    it("should have status adapter", () => {
      expect(odooDiscussPlugin.status).toBeDefined();
    });

    it("should probe account", async () => {
      // Mock version call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          '<?xml version="1.0"?><methodResponse><params><param><value><struct>' +
          "<member><name>server_version</name><value><string>19.0</string></value></member>" +
          "</struct></value></param></params></methodResponse>",
      });
      // Mock authenticate
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          '<?xml version="1.0"?><methodResponse><params><param><value><int>5</int></value></param></params></methodResponse>',
      });

      const cfg = {
        channels: {
          "odoo-discuss": {
            url: "https://erp.example.com",
            db: "test",
            user: "admin",
            password: "secret",
          },
        },
      };

      const account = odooDiscussPlugin.config.resolveAccount(cfg, "default");
      const probe = await odooDiscussPlugin.status?.probeAccount?.({
        cfg,
        account: account!,
        timeoutMs: 5000,
      });

      expect(probe?.kind).toBe("connected");
    });
  });
});
