import {
  decodeGetGateway,
  decodeGetGatewayBot,
  decodeMessage,
  encodeCreateMessage,
  type CreateMessage,
  type GetGateway,
  type GetGatewayBot,
  type Message,
  type Snowflake,
} from "./decode.js";
import { ConfigurationError, DecodeError } from "./errors.js";
import type { Clock, RestHttp, RestHttpRequest, RestHttpResponse } from "./ports.js";
import { rateLimitedHttp } from "./rest-rate-limit.js";
import { rejectUnlessOk, responseBodyText } from "./rest-http-error.js";

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

export type OutboundFile = {
  filename: string;
  bytes: Uint8Array;
  contentType?: string;
};

export type RestSurface = {
  execute: (request: RestExecuteOptions) => Promise<unknown>;
  getGateway: (options?: RestCallOptions) => Promise<GetGateway>;
  getGatewayBot: (options?: RestCallOptions) => Promise<GetGatewayBot>;
  createMessage: (channelId: Snowflake, body: CreateMessage, options?: RestCallOptions) => Promise<Message>;
  deleteMessage: (channelId: Snowflake, messageId: Snowflake, options?: RestCallOptions) => Promise<void>;
};

export function createRest(http: RestHttp, token: string, clock: Clock): RestSurface {
  http = rateLimitedHttp(http, clock);
  const botHeaders = {
    Authorization: `Bot ${token}`,
    "User-Agent": USER_AGENT,
  };
  return {
    execute: async (request) => {
      if ("files" in request && request.files !== undefined && request.files.length > 0) {
        throw new ConfigurationError("Rest hatch files require multipart encoding");
      }
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
      if ("body" in request && request.body !== undefined) {
        headers["Content-Type"] = "application/json";
        httpRequest.body = JSON.stringify(request.body);
      }
      attachSignal(httpRequest, request);
      const response = await http.request(httpRequest);
      rejectUnlessOk(response);
      const text = responseBodyText(response);
      if (text === "") {
        return undefined;
      }
      const parsed: unknown = JSON.parse(text);
      return parsed;
    },
    getGateway: async (options) => {
      const httpRequest: RestHttpRequest = {
        method: "GET",
        url: `${API_BASE}/gateway`,
        headers: {
          "User-Agent": USER_AGENT,
        },
      };
      attachSignal(httpRequest, options);
      const response = await http.request(httpRequest);
      rejectUnlessOk(response);
      return decodeGetGateway(parseJsonBody(response, "Get Gateway"));
    },
    getGatewayBot: async (options) => {
      const httpRequest: RestHttpRequest = {
        method: "GET",
        url: `${API_BASE}/gateway/bot`,
        headers: botHeaders,
      };
      attachSignal(httpRequest, options);
      const response = await http.request(httpRequest);
      rejectUnlessOk(response);
      return decodeGetGatewayBot(parseJsonBody(response, "Get Gateway Bot"));
    },
    createMessage: async (channelId, body, options) => {
      const httpRequest: RestHttpRequest = {
        method: "POST",
        url: `${API_BASE}/channels/${channelId}/messages`,
        headers: {
          ...botHeaders,
          "Content-Type": "application/json",
        },
        body: encodeCreateMessage(body),
      };
      attachSignal(httpRequest, options);
      const response = await http.request(httpRequest);
      rejectUnlessOk(response);
      return decodeMessage(parseJsonBody(response, "Create Message"));
    },
    deleteMessage: async (channelId, messageId, options) => {
      const httpRequest: RestHttpRequest = {
        method: "DELETE",
        url: `${API_BASE}/channels/${channelId}/messages/${messageId}`,
        headers: botHeaders,
      };
      attachSignal(httpRequest, options);
      const response = await http.request(httpRequest);
      rejectUnlessOk(response);
    },
  };
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
