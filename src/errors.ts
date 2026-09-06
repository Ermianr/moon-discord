export class MoonDiscordError extends Error {
  constructor(message: string = "") {
    super(message);
    this.name = "MoonDiscordError";
  }
}

export class ConfigurationError extends MoonDiscordError {
  constructor(message: string = "") {
    super(message);
    this.name = "ConfigurationError";
  }
}

export class DecodeError extends MoonDiscordError {
  constructor(message: string = "") {
    super(message);
    this.name = "DecodeError";
  }
}

export class CancelledError extends MoonDiscordError {
  constructor(message: string = "") {
    super(message);
    this.name = "CancelledError";
  }
}

export class TransportError extends MoonDiscordError {
  constructor(message: string = "") {
    super(message);
    this.name = "TransportError";
  }
}

export class DiscordHttpError extends MoonDiscordError {
  readonly status: number;
  readonly code: number;
  readonly errors?: unknown;

  constructor(fields: { status: number; code: number; message: string; errors?: unknown }) {
    super(fields.message);
    this.name = "DiscordHttpError";
    this.status = fields.status;
    this.code = fields.code;
    if ("errors" in fields) {
      this.errors = fields.errors;
    }
  }
}

export type SaturatedKind = "rest_wait" | "gateway_queue" | "gateway_session_wait";

export class SaturatedError extends MoonDiscordError {
  readonly kind: SaturatedKind;
  readonly retryAfterMs?: number;

  constructor(fields: { kind: SaturatedKind; retryAfterMs?: number; message?: string }) {
    super(fields.message === undefined ? "" : fields.message);
    this.name = "SaturatedError";
    this.kind = fields.kind;
    if (fields.retryAfterMs !== undefined) {
      this.retryAfterMs = fields.retryAfterMs;
    }
  }
}

export class GatewayFatalError extends MoonDiscordError {
  readonly closeCode: number;

  constructor(fields: { closeCode: number; message?: string }) {
    super(fields.message === undefined ? "" : fields.message);
    this.name = "GatewayFatalError";
    this.closeCode = fields.closeCode;
  }
}

export const REST_MAX_WAIT_MS = 600_000;
export const HTTP_5XX_RETRY_MS = 1_000;
export const GATEWAY_SEND_QUEUE = 120;
export const GATEWAY_SESSION_WAIT_MS = 60_000;
