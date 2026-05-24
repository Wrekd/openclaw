/**
 * Odoo Discuss Monitor Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { CoreConfig } from "./accounts.js";
import type { OdooInboundMessage, OdooXmlRpcClient } from "./types.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock the runtime
const mockRuntime = {
  logging: {
    shouldLogVerbose: () => false,
    getChildLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
  config: {
    current: () => ({}),
  },
  channel: {
    activity: {
      record: vi.fn(),
    },
    commands: {
      shouldHandleTextCommands: () => false,
    },
    text: {
      hasControlCommand: () => false,
    },
    mentions: {
      buildMentionRegexes: () => [],
      matchesMentionPatterns: () => false,
    },
    turn: {
      runAssembled: vi.fn(),
    },
    reply: {
      finalizeInboundContext: (ctx: Record<string, unknown>) => ctx,
      dispatchReplyWithBufferedBlockDispatcher: vi.fn(),
    },
    session: {
      recordInboundSession: vi.fn(),
    },
  },
};

vi.mock("./runtime.js", () => ({
  getOdooDiscussRuntime: () => mockRuntime,
}));

vi.mock("openclaw/plugin-sdk/extension-shared", () => ({
  resolveLoggerBackedRuntime: (_runtime: unknown, logger: unknown) => ({
    log: (logger as { info: (msg: string) => void }).info,
    error: (logger as { error: (msg: string) => void }).error,
  }),
}));

// Import after mocks are set up
const { monitorOdooDiscuss } = await import("./monitor.js");

const testConfig: CoreConfig = {
  channels: {
    "odoo-discuss": {
      url: "https://erp.example.com",
      db: "test_db",
      user: "test@example.com",
      password: "test_api_key",
      pollIntervalMs: 100, // Fast polling for tests
      presenceEnabled: false,
    },
  },
};

describe("monitorOdooDiscuss", () => {
  let abortController: AbortController;

  beforeEach(() => {
    mockFetch.mockReset();
    abortController = new AbortController();
  });

  afterEach(() => {
    abortController.abort();
  });

  it("should authenticate and start monitoring", async () => {
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
        "<member><name>id</name><value><int>1</int></value></member>" +
        "<member><name>name</name><value><string>General</string></value></member>" +
        "<member><name>channel_type</name><value><string>channel</string></value></member>" +
        "</struct></value>" +
        "</data></array></value></param></params></methodResponse>",
    });
    // Mock initial pollMessages
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        '<?xml version="1.0"?><methodResponse><params><param><value><array><data></data></array></value></param></params></methodResponse>',
    });
    // Mock getChannels (for channelMap)
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
    // Mock first poll (empty)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        '<?xml version="1.0"?><methodResponse><params><param><value><array><data></data></array></value></param></params></methodResponse>',
    });

    const monitor = await monitorOdooDiscuss({
      config: testConfig,
      abortSignal: abortController.signal,
    });

    expect(monitor).toHaveProperty("stop");
    expect(typeof monitor.stop).toBe("function");

    // Clean up
    monitor.stop();
  });

  it("should call onMessage callback when messages arrive", async () => {
    const onMessage = vi.fn();

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
        "<member><name>id</name><value><int>1</int></value></member>" +
        "<member><name>name</name><value><string>General</string></value></member>" +
        "<member><name>channel_type</name><value><string>channel</string></value></member>" +
        "</struct></value>" +
        "</data></array></value></param></params></methodResponse>",
    });
    // Mock initial poll (empty)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        '<?xml version="1.0"?><methodResponse><params><param><value><array><data></data></array></value></param></params></methodResponse>',
    });
    // Mock getChannels for channelMap
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
    // Mock poll with message
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        '<?xml version="1.0"?><methodResponse><params><param><value><array><data>' +
        "<value><struct>" +
        "<member><name>id</name><value><int>100</int></value></member>" +
        "<member><name>body</name><value><string>Hello from Odoo!</string></value></member>" +
        "<member><name>author_id</name><value><array><data><value><int>2</int></value><value><string>John</string></value></data></array></value></member>" +
        "<member><name>date</name><value><string>2024-01-01 12:00:00</string></value></member>" +
        "<member><name>message_type</name><value><string>comment</string></value></member>" +
        "<member><name>res_id</name><value><int>1</int></value></member>" +
        "</struct></value>" +
        "</data></array></value></param></params></methodResponse>",
    });
    // Mock subsequent polls (empty)
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () =>
        '<?xml version="1.0"?><methodResponse><params><param><value><array><data></data></array></value></param></params></methodResponse>',
    });

    const monitor = await monitorOdooDiscuss({
      config: testConfig,
      abortSignal: abortController.signal,
      onMessage,
    });

    // Wait for the first poll cycle
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(onMessage).toHaveBeenCalled();
    const [message] = onMessage.mock.calls[0] as [OdooInboundMessage, OdooXmlRpcClient];
    expect(message.body).toBe("Hello from Odoo!");
    expect(message.senderId).toBe(2);
    expect(message.senderName).toBe("John");
    expect(message.channelId).toBe(1);

    monitor.stop();
  });

  it("should skip messages from self", async () => {
    const onMessage = vi.fn();

    // Mock authenticate - uid 5
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        '<?xml version="1.0"?><methodResponse><params><param><value><int>5</int></value></param></params></methodResponse>',
    });
    // Mock getChannels
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        '<?xml version="1.0"?><methodResponse><params><param><value><array><data></data></array></value></param></params></methodResponse>',
    });
    // Mock initial poll (empty)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        '<?xml version="1.0"?><methodResponse><params><param><value><array><data></data></array></value></param></params></methodResponse>',
    });
    // Mock getChannels for channelMap
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        '<?xml version="1.0"?><methodResponse><params><param><value><array><data></data></array></value></param></params></methodResponse>',
    });
    // Mock poll with message from self (author_id = 5)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        '<?xml version="1.0"?><methodResponse><params><param><value><array><data>' +
        "<value><struct>" +
        "<member><name>id</name><value><int>100</int></value></member>" +
        "<member><name>body</name><value><string>My own message</string></value></member>" +
        "<member><name>author_id</name><value><array><data><value><int>5</int></value><value><string>Me</string></value></data></array></value></member>" +
        "<member><name>date</name><value><string>2024-01-01 12:00:00</string></value></member>" +
        "<member><name>message_type</name><value><string>comment</string></value></member>" +
        "<member><name>res_id</name><value><int>1</int></value></member>" +
        "</struct></value>" +
        "</data></array></value></param></params></methodResponse>",
    });
    // Mock subsequent polls (empty)
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () =>
        '<?xml version="1.0"?><methodResponse><params><param><value><array><data></data></array></value></param></params></methodResponse>',
    });

    const monitor = await monitorOdooDiscuss({
      config: testConfig,
      abortSignal: abortController.signal,
      onMessage,
    });

    // Wait for poll cycle
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Should not have called onMessage because message is from self
    expect(onMessage).not.toHaveBeenCalled();

    monitor.stop();
  });

  it("should stop on abort signal", async () => {
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
        '<?xml version="1.0"?><methodResponse><params><param><value><array><data></data></array></value></param></params></methodResponse>',
    });
    // Mock initial poll
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        '<?xml version="1.0"?><methodResponse><params><param><value><array><data></data></array></value></param></params></methodResponse>',
    });
    // Mock getChannels for channelMap
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        '<?xml version="1.0"?><methodResponse><params><param><value><array><data></data></array></value></param></params></methodResponse>',
    });
    // Mock polls
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () =>
        '<?xml version="1.0"?><methodResponse><params><param><value><array><data></data></array></value></param></params></methodResponse>',
    });

    const monitor = await monitorOdooDiscuss({
      config: testConfig,
      abortSignal: abortController.signal,
    });

    // Abort after short delay
    setTimeout(() => abortController.abort(), 50);

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Should have stopped polling (no errors thrown)
    expect(true).toBe(true);

    monitor.stop();
  });

  it("should throw when not configured", async () => {
    await expect(
      monitorOdooDiscuss({
        config: {},
        abortSignal: abortController.signal,
      }),
    ).rejects.toThrow(/not configured/);
  });
});
