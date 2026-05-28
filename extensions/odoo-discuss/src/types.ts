/**
 * Odoo Discuss Types
 */

export interface OdooDiscussConfig {
  url: string;
  db: string;
  user: string;
  password: string;
  pollIntervalMs?: number;
  defaultChannelId?: number;
  allowFrom?: string[];
  dmPolicy?: "open" | "allowlist" | "pairing" | "disabled";
  groupPolicy?: "open" | "allowlist" | "disabled";
  allowedChannels?: number[];
  botName?: string;
  presenceEnabled?: boolean;
}

export interface ResolvedOdooDiscussAccount {
  accountId: string;
  config: OdooDiscussConfig;
  uid?: number;
  configured: boolean;
  enabled: boolean;
}

export interface OdooDiscussRuntime {
  logging: {
    shouldLogVerbose: () => boolean;
    getChildLogger: (opts?: { channel?: string; accountId?: string }) => {
      info: (message: string) => void;
      debug?: (message: string) => void;
      warn: (message: string) => void;
      error: (message: string) => void;
    };
  };
  config: {
    current: () => unknown;
  };
  channel: {
    activity: {
      record: (params: {
        channel: string;
        accountId: string;
        direction: "inbound" | "outbound";
        at?: number;
      }) => void;
    };
    commands: {
      shouldHandleTextCommands: (params: { cfg: unknown; surface: string }) => boolean;
    };
    text: {
      hasControlCommand: (body: string, cfg: unknown) => boolean;
    };
    mentions: {
      buildMentionRegexes: (cfg: unknown) => RegExp[];
      matchesMentionPatterns: (body: string, patterns: RegExp[]) => boolean;
    };
    turn: {
      runAssembled: (params: unknown) => Promise<void>;
    };
    reply: {
      finalizeInboundContext: (ctx: Record<string, unknown>) => Record<string, unknown>;
      dispatchReplyWithBufferedBlockDispatcher: unknown;
    };
    session: {
      recordInboundSession: unknown;
    };
  };
}

export interface OdooDiscussProbe {
  kind: "connected" | "error";
  uid?: number;
  error?: string;
  serverVersion?: string;
}

export interface OdooMessage {
  id: number;
  body: string;
  author_id: [number, string] | false;
  date: string;
  res_id?: number;
  model?: string;
  message_type?: string;
  record_name?: string;
  channel_ids?: number[];
  partner_ids?: number[];
  parent_id?: [number, string] | false;
  author?: {
    id: number;
    name: string;
  };
}

export interface OdooChannel {
  id: number;
  name: string;
  channel_type: "channel" | "group" | "chat";
  description?: string;
  member_count?: number;
}

export interface OdooInboundMessage {
  messageId: string;
  channelId: number;
  channelName: string;
  isGroup: boolean;
  senderId: number;
  senderName: string;
  body: string;
  timestamp: number;
  replyToBot?: boolean;
}

export interface OdooXmlRpcClient {
  authenticate(): Promise<number>;
  call<T>(
    model: string,
    method: string,
    args: unknown[],
    kwargs?: Record<string, unknown>,
  ): Promise<T>;
  searchRead<T>(
    model: string,
    domain: unknown[],
    fields: string[],
    options?: { limit?: number; offset?: number; order?: string },
  ): Promise<T[]>;
  setPresence(status: "online" | "offline"): Promise<void>;
  getChannels(): Promise<OdooChannel[]>;
  getMessages(channelId: number, lastMessageId?: number): Promise<OdooMessage[]>;
  sendMessage(channelId: number, body: string): Promise<number>;
  pollMessages(lastMessageId?: number): Promise<OdooMessage[]>;
}

export interface OdooConnectionInfo {
  uid: number;
  serverVersion: string;
}

export type { RuntimeEnv } from "openclaw/plugin-sdk/runtime";
