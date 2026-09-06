import { CancelledError, DiscordHttpError, TransportError } from "../errors.js";
import type { RestHttpResponse } from "../ports.js";

export function rejectUnlessOk(response: RestHttpResponse): void {
  if (response.status >= 200 && response.status < 300) {
    return;
  }
  throw toDiscordHttpError(response);
}

export function toDiscordHttpError(response: RestHttpResponse): DiscordHttpError {
  const text = responseBodyText(response);
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const codeValue = "code" in parsed ? parsed.code : undefined;
      const messageValue = "message" in parsed ? parsed.message : undefined;
      const code = typeof codeValue === "number" ? codeValue : 0;
      const message = typeof messageValue === "string" ? messageValue : `HTTP ${String(response.status)}`;
      if ("errors" in parsed) {
        return new DiscordHttpError({
          status: response.status,
          code,
          message,
          errors: parsed.errors,
        });
      }
      return new DiscordHttpError({
        status: response.status,
        code,
        message,
      });
    }
  } catch {
    // Non-JSON bodies use the HTTP status message below.
  }
  return new DiscordHttpError({
    status: response.status,
    code: 0,
    message: `HTTP ${String(response.status)}`,
  });
}

export function responseBodyText(response: RestHttpResponse): string {
  if (typeof response.body === "string") {
    return response.body;
  }
  return new TextDecoder().decode(response.body);
}

export function retryAfterMs(response: RestHttpResponse): number | undefined {
  const header = headerValue(response.headers, "retry-after");
  if (header !== undefined && header !== "") {
    const seconds = Number(header);
    if (seconds === seconds) {
      return Math.ceil(seconds * 1000);
    }
  }
  try {
    const parsed: unknown = JSON.parse(responseBodyText(response));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && "retry_after" in parsed) {
      const value = parsed.retry_after;
      if (typeof value === "number" && value === value) {
        return Math.ceil(value * 1000);
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function mapHttpAdapterError(error: unknown): never {
  if (error instanceof Error) {
    if (error.name === "CancelledError" || error.name === "SaturatedError" || error.name === "TransportError") {
      throw error;
    }
    if (error.name === "AbortError") {
      throw new CancelledError();
    }
    throw new TransportError(error.message);
  }
  throw new TransportError();
}

export function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const keys = Object.keys(headers);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (key !== undefined && key.toLowerCase() === name) {
      return headers[key];
    }
  }
  return undefined;
}
