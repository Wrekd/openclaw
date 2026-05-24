/**
 * Odoo Discuss Send Message Tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { CoreConfig } from "./accounts.js";
import { sendMessageOdooDiscuss, sendMessageToChannel } from "./send.js";

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

const testConfig: CoreConfig = {
  channels: {
    "odoo-discuss": {
      url: "https://erp.example.com",
      db: "test_db",
      user: "test@example.com",
      password: "test_api_key",
    },
  },
};

describe("sendMessageOdooDiscuss", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("should send message and return message ID", async () => {
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

    const messageId = await sendMessageOdooDiscuss(1, "Hello, Odoo!", {
      cfg: testConfig,
    });

    expect(messageId).toBe(999);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Check the message_post call
    const lastCallBody = mockFetch.mock.calls[1][1].body;
    expect(lastCallBody).toContain("discuss.channel");
    expect(lastCallBody).toContain("message_post");
    expect(lastCallBody).toContain("Hello, Odoo!");
  });

  it("should throw when not configured", async () => {
    await expect(sendMessageOdooDiscuss(1, "Hello", { cfg: {} })).rejects.toThrow(/not configured/);
  });

  it("should throw on API error", async () => {
    // Mock authenticate
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        '<?xml version="1.0"?><methodResponse><params><param><value><int>5</int></value></param></params></methodResponse>',
    });
    // Mock message_post failure
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        '<?xml version="1.0"?><methodResponse><fault><value><struct>' +
        "<member><name>faultCode</name><value><int>1</int></value></member>" +
        "<member><name>faultString</name><value><string>Access Denied</string></value></member>" +
        "</struct></value></fault></methodResponse>",
    });

    await expect(sendMessageOdooDiscuss(1, "Hello", { cfg: testConfig })).rejects.toThrow(
      /Access Denied/,
    );
  });

  it("should use custom account ID", async () => {
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

    const messageId = await sendMessageOdooDiscuss(1, "Test", {
      cfg: testConfig,
      accountId: "custom",
    });

    expect(messageId).toBe(123);
  });
});

describe("sendMessageToChannel", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("should send to channel by numeric ID", async () => {
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
        '<?xml version="1.0"?><methodResponse><params><param><value><int>456</int></value></param></params></methodResponse>',
    });

    const messageId = await sendMessageToChannel(42, "Hello channel 42", {
      cfg: testConfig,
    });

    expect(messageId).toBe(456);
  });

  it("should find channel by name", async () => {
    // Mock authenticate
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        '<?xml version="1.0"?><methodResponse><params><param><value><int>5</int></value></param></params></methodResponse>',
    });
    // Mock getChannels
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        '<?xml version="1.0"?><methodResponse><params><param><value><array><data>' +
        "<value><struct>" +
        "<member><name>id</name><value><int>7</int></value></member>" +
        "<member><name>name</name><value><string>General</string></value></member>" +
        "<member><name>channel_type</name><value><string>channel</string></value></member>" +
        "</struct></value>" +
        "</data></array></value></param></params></methodResponse>",
    });
    // Mock message_post
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        '<?xml version="1.0"?><methodResponse><params><param><value><int>789</int></value></param></params></methodResponse>',
    });

    const messageId = await sendMessageToChannel("General", "Hello General!", {
      cfg: testConfig,
    });

    expect(messageId).toBe(789);
  });

  it("should throw when channel not found by name", async () => {
    // Mock authenticate
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        '<?xml version="1.0"?><methodResponse><params><param><value><int>5</int></value></param></params></methodResponse>',
    });
    // Mock getChannels (empty)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        '<?xml version="1.0"?><methodResponse><params><param><value><array><data></data></array></value></param></params></methodResponse>',
    });

    await expect(sendMessageToChannel("NonExistent", "Hello", { cfg: testConfig })).rejects.toThrow(
      /not found/,
    );
  });
});
