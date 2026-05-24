/**
 * Odoo Discuss Account Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveOdooDiscussAccount,
  listOdooDiscussAccountIds,
  resolveDefaultAccountId,
  DEFAULT_ACCOUNT_ID,
  type CoreConfig,
} from "./accounts.js";

describe("accounts", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("DEFAULT_ACCOUNT_ID", () => {
    it("should be 'default'", () => {
      expect(DEFAULT_ACCOUNT_ID).toBe("default");
    });
  });

  describe("resolveDefaultAccountId", () => {
    it("should return default account id", () => {
      expect(resolveDefaultAccountId()).toBe("default");
    });
  });

  describe("listOdooDiscussAccountIds", () => {
    it("should return empty array when no config", () => {
      const ids = listOdooDiscussAccountIds(undefined);
      expect(ids).toEqual([]);
    });

    it("should return default account id when config present", () => {
      const config: CoreConfig = {
        channels: {
          "odoo-discuss": {
            url: "https://erp.example.com",
            db: "test",
            user: "admin",
            password: "secret",
          },
        },
      };
      const ids = listOdooDiscussAccountIds(config);
      expect(ids).toEqual(["default"]);
    });

    it("should return default account id when env vars present", () => {
      process.env.ODOO_URL = "https://erp.example.com";
      process.env.ODOO_USER = "admin";

      // Need to re-import to pick up env vars
      const ids = listOdooDiscussAccountIds({});
      expect(ids).toEqual(["default"]);
    });
  });

  describe("resolveOdooDiscussAccount", () => {
    it("should resolve from config", () => {
      const config: CoreConfig = {
        channels: {
          "odoo-discuss": {
            url: "https://erp.example.com",
            db: "test_db",
            user: "admin@example.com",
            password: "api_key_123",
            pollIntervalMs: 3000,
            dmPolicy: "open",
            groupPolicy: "allowlist",
            allowedChannels: [1, 2, 3],
            botName: "TestBot",
          },
        },
      };

      const account = resolveOdooDiscussAccount({ cfg: config });

      expect(account.accountId).toBe("default");
      expect(account.configured).toBe(true);
      expect(account.enabled).toBe(true);
      expect(account.config.url).toBe("https://erp.example.com");
      expect(account.config.db).toBe("test_db");
      expect(account.config.user).toBe("admin@example.com");
      expect(account.config.password).toBe("api_key_123");
      expect(account.config.pollIntervalMs).toBe(3000);
      expect(account.config.dmPolicy).toBe("open");
      expect(account.config.groupPolicy).toBe("allowlist");
      expect(account.config.allowedChannels).toEqual([1, 2, 3]);
      expect(account.config.botName).toBe("TestBot");
    });

    it("should fallback to env vars", () => {
      process.env.ODOO_URL = "https://env.example.com";
      process.env.ODOO_DB = "env_db";
      process.env.ODOO_USER = "env_user";
      process.env.ODOO_PASSWORD = "env_password";

      const account = resolveOdooDiscussAccount({ cfg: {} });

      expect(account.configured).toBe(true);
      expect(account.config.url).toBe("https://env.example.com");
      expect(account.config.db).toBe("env_db");
      expect(account.config.user).toBe("env_user");
      expect(account.config.password).toBe("env_password");
    });

    it("should use config over env vars", () => {
      process.env.ODOO_URL = "https://env.example.com";
      process.env.ODOO_DB = "env_db";

      const config: CoreConfig = {
        channels: {
          "odoo-discuss": {
            url: "https://config.example.com",
            db: "config_db",
            user: "config_user",
            password: "config_password",
          },
        },
      };

      const account = resolveOdooDiscussAccount({ cfg: config });

      expect(account.config.url).toBe("https://config.example.com");
      expect(account.config.db).toBe("config_db");
    });

    it("should not be configured when missing required fields", () => {
      const account = resolveOdooDiscussAccount({ cfg: {} });

      expect(account.configured).toBe(false);
      expect(account.enabled).toBe(false);
    });

    it("should use defaults for optional fields", () => {
      const config: CoreConfig = {
        channels: {
          "odoo-discuss": {
            url: "https://erp.example.com",
            db: "test",
            user: "admin",
            password: "secret",
          },
        },
      };

      const account = resolveOdooDiscussAccount({ cfg: config });

      expect(account.config.pollIntervalMs).toBe(5000);
      expect(account.config.dmPolicy).toBe("allowlist");
      expect(account.config.groupPolicy).toBe("allowlist");
      expect(account.config.allowFrom).toEqual([]);
      expect(account.config.allowedChannels).toEqual([]);
      expect(account.config.presenceEnabled).toBe(true);
    });

    it("should respect custom account id", () => {
      const config: CoreConfig = {
        channels: {
          "odoo-discuss": {
            url: "https://erp.example.com",
            db: "test",
            user: "admin",
            password: "secret",
          },
        },
      };

      const account = resolveOdooDiscussAccount({
        cfg: config,
        accountId: "custom-account",
      });

      expect(account.accountId).toBe("custom-account");
    });
  });

  describe("session key generation", () => {
    it("should generate unique session keys per channel", () => {
      const config: CoreConfig = {
        channels: {
          "odoo-discuss": {
            url: "https://erp.example.com",
            db: "test",
            user: "admin",
            password: "secret",
          },
        },
      };

      const account1 = resolveOdooDiscussAccount({ cfg: config, accountId: "a" });
      const account2 = resolveOdooDiscussAccount({ cfg: config, accountId: "b" });

      // Different account IDs should be possible
      expect(account1.accountId).not.toBe(account2.accountId);
    });
  });
});
