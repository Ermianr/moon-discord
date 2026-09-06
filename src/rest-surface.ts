import { decodeGetGateway, type GetGateway } from "./decode.js";
import { DecodeError } from "./errors.js";
import type { RestHttp, RestHttpResponse } from "./ports.js";

const USER_AGENT = "DiscordBot (https://github.com/Ermianr/moon-discord, 0.0.0)";
const API_BASE = "https://discord.com/api/v10";

export type RestSurface = {
  getGateway: () => Promise<GetGateway>;
};

export function createRest(http: RestHttp): RestSurface {
  return {
    getGateway: async () => {
      const response = await http.request({
        method: "GET",
        url: `${API_BASE}/gateway`,
        headers: {
          "User-Agent": USER_AGENT,
        },
      });
      return decodeGetGateway(parseJsonBody(response));
    },
  };
}

function parseJsonBody(response: RestHttpResponse): unknown {
  const text = typeof response.body === "string" ? response.body : new TextDecoder().decode(response.body);
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    throw new DecodeError("Get Gateway body is not JSON");
  }
}
