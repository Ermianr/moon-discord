import type { RestHttp } from "./ports.js";

export function fetchHttp(): RestHttp {
  return {
    request: async (request) => {
      const init: RequestInit = {
        method: request.method,
        headers: request.headers,
      };
      if (request.body !== undefined) {
        if (typeof request.body === "string") {
          init.body = request.body;
        } else {
          init.body = Buffer.from(request.body);
        }
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
