import { mapHttpAdapterError } from "./rest/http-error.js";
import type { RestHttp } from "./ports.js";

export function fetchHttp(): RestHttp {
  return {
    request: async (request) => {
      const init: RequestInit = {
        method: request.method,
        headers: request.headers,
      };
      if (typeof request.body === "string") {
        init.body = request.body;
      } else if (request.body !== undefined) {
        const source = request.body;
        const bytes = new Uint8Array(source.length);
        for (let index = 0; index < source.length; index += 1) {
          bytes[index] = source[index] ?? 0;
        }
        init.body = bytes;
      }
      if ("signal" in request && request.signal !== undefined) {
        init.signal = request.signal;
      }
      try {
        const response = await fetch(request.url, init);
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key, _headers) => {
          headers[key] = value;
        });
        return {
          status: response.status,
          headers,
          body: await response.bytes(),
        };
      } catch (error: unknown) {
        mapHttpAdapterError(error);
      }
    },
  };
}

