/**
 * Odoo XML-RPC Client Tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { OdooDiscussConfig } from "./types.js";
import { createOdooXmlRpcClient, stripHtml, testConnection } from "./xmlrpc-client.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

const testConfig: OdooDiscussConfig = {
  url: "https://erp.example.com",
  db: "test_db",
  user: "test@example.com",
  password: "test_api_key",
};

describe("createOdooXmlRpcClient", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe("authenticate", () => {
    it("should authenticate successfully and return uid", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          '<?xml version="1.0"?><methodResponse><params><param><value><int>42</int></value></param></params></methodResponse>',
      });

      const client = createOdooXmlRpcClient(testConfig);
      const uid = await client.authenticate();

      expect(uid).toBe(42);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://erp.example.com/xmlrpc/2/common",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "text/xml" },
        }),
      );
    });

    it("should throw on authentication failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          '<?xml version="1.0"?><methodResponse><params><param><value><boolean>0</boolean></value></param></params></methodResponse>',
      });

      const client = createOdooXmlRpcClient(testConfig);
      await expect(client.authenticate()).rejects.toThrow("Authentication failed");
    });

    it("should handle HTTP errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      const client = createOdooXmlRpcClient(testConfig);
      await expect(client.authenticate()).rejects.toThrow("HTTP 500");
    });
  });

  describe("call", () => {
    it("should call model methods", async () => {
      // Mock authenticate
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          '<?xml version="1.0"?><methodResponse><params><param><value><int>42</int></value></param></params></methodResponse>',
      });
      // Mock call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          '<?xml version="1.0"?><methodResponse><params><param><value><int>123</int></value></param></params></methodResponse>',
      });

      const client = createOdooXmlRpcClient(testConfig);
      const result = await client.call<number>("res.partner", "search_count", [[]]);

      expect(result).toBe(123);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("sendMessage", () => {
    it("should send message to channel", async () => {
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
          '<?xml version="1.0"?><methodResponse><params><param><value><int>999</int></value></param></params></methodResponse>',
      });

      const client = createOdooXmlRpcClient(testConfig);
      const messageId = await client.sendMessage(1, "Hello from test!");

      expect(messageId).toBe(999);
    });
  });

  describe("getChannels", () => {
    it("should fetch channels where user is member", async () => {
      // Mock authenticate
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          '<?xml version="1.0"?><methodResponse><params><param><value><int>5</int></value></param></params></methodResponse>',
      });
      // Mock search_read
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          '<?xml version="1.0"?><methodResponse><params><param><value><array><data>' +
          "<value><struct>" +
          "<member><name>id</name><value><int>1</int></value></member>" +
          "<member><name>name</name><value><string>General</string></value></member>" +
          "<member><name>channel_type</name><value><string>channel</string></value></member>" +
          "</struct></value>" +
          "</data></array></value></param></params></methodResponse>",
      });

      const client = createOdooXmlRpcClient(testConfig);
      const channels = await client.getChannels();

      expect(channels).toHaveLength(1);
      expect(channels[0].id).toBe(1);
      expect(channels[0].name).toBe("General");
    });
  });

  describe("setPresence", () => {
    it("should set user presence to online", async () => {
      // Mock authenticate
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          '<?xml version="1.0"?><methodResponse><params><param><value><int>5</int></value></param></params></methodResponse>',
      });
      // Mock presence update
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          '<?xml version="1.0"?><methodResponse><params><param><value><boolean>1</boolean></value></param></params></methodResponse>',
      });

      const client = createOdooXmlRpcClient(testConfig);
      await expect(client.setPresence("online")).resolves.not.toThrow();
    });
  });

  describe("pollMessages", () => {
    it("should poll for new messages after lastMessageId", async () => {
      // Mock authenticate
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          '<?xml version="1.0"?><methodResponse><params><param><value><int>5</int></value></param></params></methodResponse>',
      });
      // Mock search_read for messages
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          '<?xml version="1.0"?><methodResponse><params><param><value><array><data>' +
          "<value><struct>" +
          "<member><name>id</name><value><int>100</int></value></member>" +
          "<member><name>body</name><value><string>Test message</string></value></member>" +
          "<member><name>author_id</name><value><array><data><value><int>2</int></value><value><string>John</string></value></data></array></value></member>" +
          "<member><name>date</name><value><string>2024-01-01 12:00:00</string></value></member>" +
          "<member><name>message_type</name><value><string>comment</string></value></member>" +
          "</struct></value>" +
          "</data></array></value></param></params></methodResponse>",
      });

      const client = createOdooXmlRpcClient(testConfig);
      const messages = await client.pollMessages(50);

      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe(100);
      expect(messages[0].body).toBe("Test message");
    });
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
    expect(stripHtml("&lt;script&gt;&amp;&nbsp;")).toBe("<script>& ");
  });

  it("should handle p tags as paragraphs", () => {
    expect(stripHtml("<p>Para 1</p><p>Para 2</p>")).toBe("Para 1\nPara 2");
  });
});

describe("testConnection", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("should return uid and server version on success", async () => {
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

    const result = await testConnection(testConfig);

    expect(result.uid).toBe(5);
    expect(result.serverVersion).toBe("19.0");
  });
});
