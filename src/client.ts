import { ConfigurationError } from "./errors.js";
import type { Ports } from "./ports.js";
import type { ClientOptions } from "./types.js";

export type RestSurface = Record<string, never>;

export class Client {
  readonly rest: RestSurface = {};
  readonly closed: Promise<void>;

  #ports: Ports;
  #options: ClientOptions;
  #resolveClosed = () => {};

  constructor(options: ClientOptions, ports: Ports) {
    let resolveClosed = () => {};
    this.closed = new Promise((resolve) => {
      resolveClosed = resolve;
    });
    this.#resolveClosed = resolveClosed;
    this.#ports = ports;
    this.#options = options;
  }

  on(_dispatch: string, _handler: (payload: unknown) => void): () => void {
    return () => {};
  }

  onUnknownDispatch(_handler: (payload: unknown) => void): () => void {
    return () => {};
  }

  connect(_options?: { signal?: AbortSignal }): Promise<void> {
    if (!this.#ports.gatewayEnabled) {
      return Promise.reject(
        new ConfigurationError("connect is not available on moon-discord/rest"),
      );
    }
    if (this.#options.intents === undefined) {
      return Promise.reject(new ConfigurationError("intents are required before connect"));
    }
    return new Promise(() => {});
  }

  disconnect(): Promise<void> {
    this.#resolveClosed();
    return Promise.resolve();
  }

  updatePresence(_presence: unknown, _options?: { signal?: AbortSignal }): Promise<void> {
    return this.#rejectGatewaySend();
  }

  updateVoiceState(_voiceState: unknown, _options?: { signal?: AbortSignal }): Promise<void> {
    return this.#rejectGatewaySend();
  }

  requestGuildMembers(_query: unknown, _options?: { signal?: AbortSignal }): Promise<void> {
    return this.#rejectGatewaySend();
  }

  requestSoundboardSounds(_query: unknown, _options?: { signal?: AbortSignal }): Promise<void> {
    return this.#rejectGatewaySend();
  }

  requestChannelInfo(_query: unknown, _options?: { signal?: AbortSignal }): Promise<void> {
    return this.#rejectGatewaySend();
  }

  #rejectGatewaySend(): Promise<void> {
    if (!this.#ports.gatewayEnabled) {
      return Promise.reject(
        new ConfigurationError("Gateway send is not available on moon-discord/rest"),
      );
    }
    return Promise.reject(new ConfigurationError("Gateway send requires connect() to have resolved"));
  }
}

export function createClient(options: ClientOptions, ports: Ports): Client {
  return new Client(options, ports);
}
