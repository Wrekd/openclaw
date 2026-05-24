/**
 * Odoo Discuss Probe Tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { CoreConfig } from "./accounts.js";
import { probeOdooDiscuss } from "./probe.js";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("probeOdooDiscuss", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  const configuredConfig: CoreConfig = {
    channels: {
      "odoo-discuss": {
        url: "https://erp.example.com",
        db: "test_db",
        user: "test@example.com",
        password: "test_api_key",
      },
    },
  };

  it("should return connected probe on success", async () => {
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

    const probe = await probeOdooDiscuss(configuredConfig);

    expect(probe.kind).toBe("connected");
    expect(probe.uid).toBe(5);
    expect(probe.serverVersion).toBe("19.0");
  });

  it("should return error probe when not configured", async () => {
    const probe = await probeOdooDiscuss({});

    expect(probe.kind).toBe("error");
    expect(probe.error).toContain("not configured");
  });

  it("should return error probe on connection failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

    const probe = await probeOdooDiscuss(configuredConfig);

    expect(probe.kind).toBe("error");
    expect(probe.error).toContain("Connection refused");
  });

  it("should return error probe on authentication failure", async () => {
    // Mock version call success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        '<?xml version="1.0"?><methodResponse><params><param><value><struct>' +
        "<member><name>server_version</name><value><string>19.0</string></value></member>" +
        "</struct></value></param></params></methodResponse>",
    });
    // Mock authenticate failure
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () =>
        '<?xml version="1.0"?><methodResponse><params><param><value><boolean>0</boolean></value></param></params></methodResponse>',
    });

    const probe = await probeOdooDiscuss(configuredConfig);

    expect(probe.kind).toBe("error");
    expect(probe.error).toContain("Authentication failed");
  });

  it("should timeout on slow connections", async () => {
    mockFetch.mockImplementationOnce(() => new Promise((resolve) => setTimeout(resolve, 15000)));

    const probe = await probeOdooDiscuss(configuredConfig, { timeoutMs: 100 });

    expect(probe.kind).toBe("error");
    expect(probe.error).toContain("timeout");
  });

  it("should handle HTTP errors", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    });

    const probe = await probeOdooDiscuss(configuredConfig);

    expect(probe.kind).toBe("error");
    expect(probe.error).toContain("503");
  });

  it("should respect custom account ID", async () => {
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
        '<?xml version="1.0"?><methodResponse><params><param><value><int>42</int></value></param></params></methodResponse>',
    });

    const probe = await probeOdooDiscuss(configuredConfig, {
      accountId: "custom-account",
    });

    expect(probe.kind).toBe("connected");
  });
});
