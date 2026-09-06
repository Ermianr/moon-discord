import { mapHttpAdapterError } from "./rest/http-error.js";
import type { RestHttp, RestHttpRequest, RestHttpResponse } from "./ports.js";

export function fetchHttp(): RestHttp {
  const request: RestHttp["request"] = async (httpRequest: RestHttpRequest): Promise<RestHttpResponse> => {
    const init: RequestInit = {
      method: httpRequest.method,
      headers: httpRequest.headers,
    };
    if (typeof httpRequest.body === "string") {
      init.body = httpRequest.body;
    } else if (httpRequest.body !== undefined) {
      const source = httpRequest.body;
      const bytes = new Uint8Array(source.length);
      for (let index = 0; index < source.length; index += 1) {
        bytes[index] = source[index] ?? 0;
      }
      init.body = bytes;
    }
    if ("signal" in httpRequest && httpRequest.signal !== undefined) {
      init.signal = httpRequest.signal;
    }
    try {
      const response = await fetch(httpRequest.url, init);
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key, _headers) => {
        headers[key] = value;
      });
      const body: string | Uint8Array = await response.bytes();
      const out: RestHttpResponse = {
        status: response.status,
        headers,
        body,
      };
      return out;
    } catch (error: unknown) {
      mapHttpAdapterError(error);
    }
  };
  return { request };
}

