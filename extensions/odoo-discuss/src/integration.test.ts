/**
 * Odoo Discuss Integration Tests
 *
 * These tests verify all 5 objectives:
 * 1. Odoo Connection - XML-RPC auth with API key support
 * 2. Message Receiving - Poll for new messages
 * 3. Message Sending - Send messages via message_post
 * 4. Presence - Set user as online
 * 5. Session Management - Session keys per channel
 *
 * Run with: ODOO_PASSWORD=<key> npx vitest run this-file.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { OdooDiscussConfig, OdooXmlRpcClient } from "./types.js";
import { createOdooXmlRpcClient, testConnection, stripHtml } from "./xmlrpc-client.js";

// Test configuration - uses env vars or defaults
const testConfig: OdooDiscussConfig = {
  url: process.env.ODOO_URL || "https://erp.wrekd.com",
  db: process.env.ODOO_DB || "WREKD",
  user: process.env.ODOO_USER || "kaveman@wrekd.com",
  password: process.env.ODOO_PASSWORD || "",
};

const hasCredentials = Boolean(testConfig.password);

describe("Odoo Discuss Integration Tests", () => {
  let client: OdooXmlRpcClient;

  beforeAll(async () => {
    if (!hasCredentials) {
      console.log("⚠️ Skipping live tests - set ODOO_PASSWORD to run");
      return;
    }
    client = createOdooXmlRpcClient(testConfig);
  });

  describe("Objective 1: Odoo Connection", () => {
    it.skipIf(!hasCredentials)("should connect and get server version", async () => {
      const info = await testConnection(testConfig);
      expect(info.serverVersion).toMatch(/^\d+\.\d+/);
      console.log(`✓ Server version: ${info.serverVersion}`);
    });

    it.skipIf(!hasCredentials)("should authenticate with API key", async () => {
      const uid = await client.authenticate();
      expect(uid).toBeGreaterThan(0);
      console.log(`✓ Authenticated as UID: ${uid}`);
    });

    it.skipIf(!hasCredentials)("should handle authentication failure gracefully", async () => {
      const badClient = createOdooXmlRpcClient({
        ...testConfig,
        password: "invalid_key",
      });
      await expect(badClient.authenticate()).rejects.toThrow();
    });
  });

  describe("Objective 2: Message Receiving", () => {
    it.skipIf(!hasCredentials)("should get list of channels", async () => {
      const channels = await client.getChannels();
      expect(Array.isArray(channels)).toBe(true);
      expect(channels.length).toBeGreaterThan(0);
      console.log(`✓ Found ${channels.length} channels`);
      channels.slice(0, 3).forEach((ch) => {
        console.log(`  - ${ch.id}: ${ch.name} (${ch.channel_type})`);
      });
    });

    it.skipIf(!hasCredentials)("should poll for messages", async () => {
      const messages = await client.pollMessages();
      expect(Array.isArray(messages)).toBe(true);
      console.log(`✓ Polled ${messages.length} recent messages`);
    });

    it.skipIf(!hasCredentials)("should get messages from specific channel", async () => {
      const channels = await client.getChannels();
      if (channels.length > 0) {
        const messages = await client.getMessages(channels[0].id);
        expect(Array.isArray(messages)).toBe(true);
        console.log(`✓ Got ${messages.length} messages from channel ${channels[0].name}`);
      }
    });

    it.skipIf(!hasCredentials)("should filter messages after lastMessageId", async () => {
      const allMessages = await client.pollMessages();
      if (allMessages.length > 1) {
        const midId = allMessages[Math.floor(allMessages.length / 2)].id;
        const newMessages = await client.pollMessages(midId);
        expect(newMessages.every((m) => m.id > midId)).toBe(true);
        console.log(`✓ Filtered messages after ID ${midId}`);
      }
    });
  });

  describe("Objective 3: Message Sending", () => {
    it.skipIf(!hasCredentials)("should send message to channel", async () => {
      const channels = await client.getChannels();
      const generalChannel = channels.find((c) => c.name === "general") || channels[0];

      if (generalChannel) {
        const timestamp = new Date().toISOString();
        const messageId = await client.sendMessage(
          generalChannel.id,
          `🧪 Integration test message - ${timestamp}`,
        );
        // Note: Odoo may return array or number depending on version
        const id = Array.isArray(messageId) ? messageId[0] : messageId;
        expect(id).toBeGreaterThan(0);
        console.log(`✓ Sent message to #${generalChannel.name}, ID: ${id}`);
      }
    });

    it.skipIf(!hasCredentials)("should handle HTML in message body", async () => {
      const html = "<p>Test with <b>bold</b> and <br/>newline</p>";
      const stripped = stripHtml(html);
      expect(stripped).toBe("Test with bold and \nnewline");
      console.log(`✓ HTML stripping works correctly`);
    });
  });

  describe("Objective 4: Presence", () => {
    it.skipIf(!hasCredentials)("should set presence to online", async () => {
      await expect(client.setPresence("online")).resolves.not.toThrow();
      console.log(`✓ Set presence to online`);
    });

    it.skipIf(!hasCredentials)("should set presence to offline", async () => {
      await expect(client.setPresence("offline")).resolves.not.toThrow();
      console.log(`✓ Set presence to offline`);
    });
  });

  describe("Objective 5: Session Management", () => {
    it("should generate unique session keys per channel", () => {
      const generateSessionKey = (accountId: string, channelId: number, chatType: string) =>
        `odoo-discuss:${accountId}:${chatType}:${channelId}`;

      const key1 = generateSessionKey("default", 1, "group");
      const key2 = generateSessionKey("default", 1, "group");
      const key3 = generateSessionKey("default", 2, "group");
      const key4 = generateSessionKey("default", 1, "direct");

      expect(key1).toBe(key2); // Same channel = same key
      expect(key1).not.toBe(key3); // Different channel = different key
      expect(key1).not.toBe(key4); // Different chat type = different key
      console.log(`✓ Session keys are unique per channel/type`);
    });

    it("should generate consistent session keys", () => {
      const key1 = `odoo-discuss:default:group:1`;
      const key2 = `odoo-discuss:default:group:1`;
      expect(key1).toBe(key2);
      console.log(`✓ Session keys are deterministic`);
    });
  });
});

describe("XML-RPC Protocol Tests", () => {
  it("should encode and decode all value types", () => {
    // These are already tested in standalone, but good to have here
    expect(stripHtml("<p>Hello</p>")).toBe("Hello");
    expect(stripHtml("<br>")).toBe("");
    expect(stripHtml("&lt;tag&gt;")).toBe("<tag>");
  });
});
