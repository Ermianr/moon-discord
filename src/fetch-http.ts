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
        const bytes = new Uint8Array(request.body.length);
        bytes.set(request.body);
        init.body = bytes;
      }
      const response = await fetch(request.url, init);
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      return {
        status: response.status,
        headers,
        body: await response.bytes(),
      };
    },
  };
}
