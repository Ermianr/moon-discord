import { ConfigurationError } from "./errors.js";
import { fetchHttp } from "./fetch-http.js";
import { createRest, type RestSurface } from "./rest-surface.js";
import { systemClock } from "./system-clock.js";
import type { ClientOptions } from "./types.js";

export class Client {
  readonly rest: RestSurface;
  readonly closed: Promise<void>;

  #resolveClosed = () => {};

  constructor(options: ClientOptions) {
    let resolveClosed = () => {};
    this.closed = new Promise<void>((resolve) => {
      resolveClosed = () => {
        resolve();
      };
    });
    this.#resolveClosed = resolveClosed;
    this.rest = createRest(fetchHttp(), options.token, systemClock());
  }

  on(_dispatch: string, _handler: (payload: unknown) => void): () => void {
    return () => {};
  }

  onUnknownDispatch(_handler: (payload: unknown) => void): () => void {
    return () => {};
  }

  connect(_options?: { signal?: AbortSignal }): Promise<void> {
    return Promise.reject(
      new ConfigurationError("connect is not available on moon-discord/rest"),
    );
  }

  disconnect(): Promise<void> {
    this.#resolveClosed();
    return Promise.resolve();
  }

  updatePresence(_presence: unknown, _options?: { signal?: AbortSignal }): Promise<void> {
    return this.rejectGatewaySend();
  }

  updateVoiceState(_voiceState: unknown, _options?: { signal?: AbortSignal }): Promise<void> {
    return this.rejectGatewaySend();
  }

  requestGuildMembers(_query: unknown, _options?: { signal?: AbortSignal }): Promise<void> {
    return this.rejectGatewaySend();
  }

  requestSoundboardSounds(_query: unknown, _options?: { signal?: AbortSignal }): Promise<void> {
    return this.rejectGatewaySend();
  }

  requestChannelInfo(_query: unknown, _options?: { signal?: AbortSignal }): Promise<void> {
    return this.rejectGatewaySend();
  }

  rejectGatewaySend(): Promise<void> {
    return Promise.reject(
      new ConfigurationError("Gateway send is not available on moon-discord/rest"),
    );
  }
}

export {
  CancelledError,
  ConfigurationError,
  DecodeError,
  DiscordHttpError,
  GATEWAY_SEND_QUEUE,
  GATEWAY_SESSION_WAIT_MS,
  GatewayFatalError,
  GatewayIntent,
  HTTP_5XX_RETRY_MS,
  MoonDiscordError,
  REST_MAX_WAIT_MS,
  SaturatedError,
  TransportError,
  type ClientOptions,
} from "./public-api.js";
