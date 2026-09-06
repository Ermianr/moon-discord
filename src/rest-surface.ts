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
import { DecodeError } from "./errors.js";
import type { RestHttp, RestHttpResponse } from "./ports.js";

const USER_AGENT = "DiscordBot (https://github.com/Ermianr/moon-discord, 0.0.0)";
const API_BASE = "https://discord.com/api/v10";

export type RestSurface = {
  getGateway: () => Promise<GetGateway>;
  getGatewayBot: () => Promise<GetGatewayBot>;
  createMessage: (channelId: Snowflake, body: CreateMessage) => Promise<Message>;
  deleteMessage: (channelId: Snowflake, messageId: Snowflake) => Promise<void>;
};

export function createRest(http: RestHttp, token: string): RestSurface {
  const botHeaders = {
    Authorization: `Bot ${token}`,
    "User-Agent": USER_AGENT,
  };
  return {
    getGateway: async () => {
      const response = await http.request({
        method: "GET",
        url: `${API_BASE}/gateway`,
        headers: {
          "User-Agent": USER_AGENT,
        },
      });
      return decodeGetGateway(parseJsonBody(response, "Get Gateway"));
    },
    getGatewayBot: async () => {
      const response = await http.request({
        method: "GET",
        url: `${API_BASE}/gateway/bot`,
        headers: botHeaders,
      });
      return decodeGetGatewayBot(parseJsonBody(response, "Get Gateway Bot"));
    },
    createMessage: async (channelId, body) => {
      const response = await http.request({
        method: "POST",
        url: `${API_BASE}/channels/${channelId}/messages`,
        headers: {
          ...botHeaders,
          "Content-Type": "application/json",
        },
        body: encodeCreateMessage(body),
      });
      return decodeMessage(parseJsonBody(response, "Create Message"));
    },
    deleteMessage: async (channelId, messageId) => {
      await http.request({
        method: "DELETE",
        url: `${API_BASE}/channels/${channelId}/messages/${messageId}`,
        headers: botHeaders,
      });
    },
  };
}

function parseJsonBody(response: RestHttpResponse, label: string): unknown {
  const text = typeof response.body === "string" ? response.body : new TextDecoder().decode(response.body);
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    throw new DecodeError(`${label} body is not JSON`);
  }
}
