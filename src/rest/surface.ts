import {
  decodeGetGateway,
  decodeGetGatewayBot,
  decodeMessage,
  decodeSticker,
  encodeCreateMessage,
  type CreateMessage,
  type GetGateway,
  type GetGatewayBot,
  type Message,
  type Snowflake,
  type Sticker,
} from "../decode/index.js";
import { DecodeError, DiscordHttpError } from "../errors.js";
import type { Clock, RestHttp, RestHttpRequest, RestHttpResponse } from "../ports.js";
import {
  encodeNamedForm,
  encodePayloadJsonFiles,
  filePart,
  type OutboundFile,
} from "./multipart.js";
import { rateLimitedHttp } from "./rate-limit.js";
import { rejectUnlessOk, responseBodyText } from "./http-error.js";

export type { OutboundFile };

const USER_AGENT = "DiscordBot (https://github.com/Ermianr/moon-discord, 0.0.0)";
const API_BASE = "https://discord.com/api/v10";

export type RestCallOptions = {
  signal?: AbortSignal;
};

export type RestExecuteOptions = {
  method: string;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  files?: OutboundFile[];
  auditReason?: string;
  signal?: AbortSignal;
};

export type CreateMessageBody = CreateMessage & {
  files?: OutboundFile[];
};

export type CreateGuildSticker = {
  name: string;
  description: string;
  tags: string;
  file: OutboundFile;
};

export type RestSurface = {
  execute: (request: RestExecuteOptions) => Promise<unknown>;
  getGateway: (options?: RestCallOptions) => Promise<GetGateway>;
  getGatewayBot: (options?: RestCallOptions) => Promise<GetGatewayBot>;
  createMessage: (channelId: Snowflake, body: CreateMessageBody, options?: RestCallOptions) => Promise<Message>;
  deleteMessage: (channelId: Snowflake, messageId: Snowflake, options?: RestCallOptions) => Promise<void>;
  createGuildSticker: (guildId: Snowflake, body: CreateGuildSticker, options?: RestCallOptions) => Promise<Sticker>;
};

export type CreateMessageDispatch = (
  channelId: Snowflake,
  body: CreateMessageBody,
  options?: RestCallOptions,
) => Promise<RestHttpResponse>;

export function createCreateMessageDispatch(http: RestHttp, token: string, clock: Clock): CreateMessageDispatch {
  return createMessageDispatch(rateLimitedHttp(http, clock, undefined), token, undefined);
}

function createMessageDispatch(
  http: RestHttp,
  token: string,
  onUnauthorized?: (error: Error) => void,
): CreateMessageDispatch {
  const botHeaders = {
    Authorization: `Bot ${token}`,
    "User-Agent": USER_AGENT,
  };
  return async (channelId, body, options) => {
    const json = encodeCreateMessage(body);
    const files = "files" in body ? body.files : undefined;
    const headers: Record<string, string> = {
      ...botHeaders,
      "Content-Type": "application/json",
    };
    const httpRequest: RestHttpRequest = {
      method: "POST",
      url: `${API_BASE}/channels/${channelId}/messages`,
      headers,
      body: json,
    };
    if (files !== undefined && files.length > 0) {
      const encoded = encodePayloadJsonFiles(json, files);
      headers["Content-Type"] = encoded.contentType;
      httpRequest.body = encoded.body;
    }
    attachSignal(httpRequest, options);
    const response = await http.request(httpRequest);
    try {
      rejectUnlessOk(response);
    } catch (error: unknown) {
      if (onUnauthorized !== undefined && error instanceof DiscordHttpError && error.status === 401) {
        onUnauthorized(error);
      }
      throw error;
    }
    return response;
  };
}

type TokenDeath = {
  dead: boolean;
  error: DiscordHttpError;
};

export function createRest(
  http: RestHttp,
  token: string,
  clock: Clock,
  onUnauthorized?: (error: Error) => void,
  tokenDeath?: TokenDeath,
): RestSurface {
  http = rateLimitedHttp(http, clock, tokenDeath);
  const notifyUnauthorized = (error: Error): void => {
    if (onUnauthorized !== undefined && error instanceof DiscordHttpError && error.status === 401) {
      onUnauthorized(error);
    }
  };
  const limited = http;
  http = {
    request: async (request) => {
      try {
        return await limited.request(request);
      } catch (error: unknown) {
        if (error instanceof Error) {
          notifyUnauthorized(error);
        }
        throw error;
      }
    },
  };
  const botHeaders = {
    Authorization: `Bot ${token}`,
    "User-Agent": USER_AGENT,
  };
  const rejectHttp = (response: RestHttpResponse): void => {
    try {
      rejectUnlessOk(response);
    } catch (error: unknown) {
      if (onUnauthorized !== undefined && error instanceof DiscordHttpError && error.status === 401) {
        onUnauthorized(error);
      }
      throw error;
    }
  };
  const dispatchCreateMessage = createMessageDispatch(http, token, onUnauthorized);
  return {
    execute: async (request) => {
      throwIfTokenDead(tokenDeath);
      const headers: Record<string, string> = {
        ...botHeaders,
      };
      if ("auditReason" in request && request.auditReason !== undefined) {
        headers["X-Audit-Log-Reason"] = encodeURIComponent(request.auditReason);
      }
      const httpRequest: RestHttpRequest = {
        method: request.method,
        url: hatchUrl(request.path, request.query),
        headers,
      };
      const files = "files" in request ? request.files : undefined;
      if (files !== undefined && files.length > 0) {
        const payloadJson = JSON.stringify("body" in request && request.body !== undefined ? request.body : {});
        const encoded = encodePayloadJsonFiles(payloadJson, files);
        headers["Content-Type"] = encoded.contentType;
        httpRequest.body = encoded.body;
      } else if ("body" in request && request.body !== undefined) {
        headers["Content-Type"] = "application/json";
        httpRequest.body = JSON.stringify(request.body);
      }
      attachSignal(httpRequest, request);
      const response = await http.request(httpRequest);
      rejectHttp(response);
      const text = responseBodyText(response);
      if (text === "") {
        return undefined;
      }
      const parsed: unknown = JSON.parse(text);
      return parsed;
    },
    getGateway: async (options) => {
      throwIfTokenDead(tokenDeath);
      const httpRequest: RestHttpRequest = {
        method: "GET",
        url: `${API_BASE}/gateway`,
        headers: {
          "User-Agent": USER_AGENT,
        },
      };
      attachSignal(httpRequest, options);
      const response = await http.request(httpRequest);
      rejectHttp(response);
      return decodeGetGateway(parseJsonBody(response, "Get Gateway"));
    },
    getGatewayBot: async (options) => {
      throwIfTokenDead(tokenDeath);
      const httpRequest: RestHttpRequest = {
        method: "GET",
        url: `${API_BASE}/gateway/bot`,
        headers: botHeaders,
      };
      attachSignal(httpRequest, options);
      const response = await http.request(httpRequest);
      rejectHttp(response);
      return decodeGetGatewayBot(parseJsonBody(response, "Get Gateway Bot"));
    },
    createMessage: async (channelId, body, options) => {
      throwIfTokenDead(tokenDeath);
      const response = await dispatchCreateMessage(channelId, body, options);
      return decodeMessage(parseJsonBody(response, "Create Message"));
    },
    deleteMessage: async (channelId, messageId, options) => {
      throwIfTokenDead(tokenDeath);
      const httpRequest: RestHttpRequest = {
        method: "DELETE",
        url: `${API_BASE}/channels/${channelId}/messages/${messageId}`,
        headers: botHeaders,
      };
      attachSignal(httpRequest, options);
      const response = await http.request(httpRequest);
      rejectHttp(response);
    },
    createGuildSticker: async (guildId, body, options) => {
      throwIfTokenDead(tokenDeath);
      const encoded = encodeNamedForm([
        { name: "name", body: utf8(body.name) },
        { name: "description", body: utf8(body.description) },
        { name: "tags", body: utf8(body.tags) },
        filePart("file", "file" in body ? body.file : undefined, "file"),
      ]);
      const httpRequest: RestHttpRequest = {
        method: "POST",
        url: `${API_BASE}/guilds/${guildId}/stickers`,
        headers: {
          ...botHeaders,
          "Content-Type": encoded.contentType,
        },
        body: encoded.body,
      };
      attachSignal(httpRequest, options);
      const response = await http.request(httpRequest);
      rejectHttp(response);
      return decodeSticker(parseJsonBody(response, "Create Guild Sticker"));
    },
  };
}

function throwIfTokenDead(tokenDeath: TokenDeath | undefined): void {
  if (tokenDeath !== undefined && tokenDeath.dead) {
    throw tokenDeath.error;
  }
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function hatchUrl(path: string, query: Record<string, string> | undefined): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  if (query === undefined) {
    return `${API_BASE}${suffix}`;
  }
  const keys = Object.keys(query);
  if (keys.length === 0) {
    return `${API_BASE}${suffix}`;
  }
  let qs = "";
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === undefined) {
      continue;
    }
    const value = query[key];
    if (value === undefined) {
      continue;
    }
    qs += `${qs === "" ? "?" : "&"}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }
  return `${API_BASE}${suffix}${qs}`;
}

function attachSignal(request: RestHttpRequest, options: RestCallOptions | undefined): void {
  if (options !== undefined && "signal" in options && options.signal !== undefined) {
    request.signal = options.signal;
  }
}

function parseJsonBody(response: RestHttpResponse, label: string): unknown {
  const text = responseBodyText(response);
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    throw new DecodeError(`${label} body is not JSON`);
  }
}
