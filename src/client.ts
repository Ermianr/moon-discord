import { ConfigurationError } from "./errors.js";
import type { GatewayConnect, Ports } from "./ports.js";
import { createRest, type RestSurface } from "./rest-surface.js";
import { startSession, type SessionHandle, type SessionOptions } from "./session.js";
import type { ClientOptions } from "./types.js";

export type { RestSurface };

export class Client {
  readonly rest: RestSurface;
  readonly closed: Promise<void>;

  #ports: Ports;
  #options: ClientOptions;
  #session: SessionHandle | undefined;
  #resolveClosed = () => {};

  constructor(options: ClientOptions, ports: Ports) {
    let resolveClosed = () => {};
    this.closed = new Promise((resolve) => {
      resolveClosed = resolve;
    });
    this.#resolveClosed = resolveClosed;
    this.#ports = ports;
    this.#options = options;
    this.rest = createRest(ports.http, options.token, ports.clock);
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
    const intents = this.#options.intents;
    if (intents === undefined) {
      return Promise.reject(new ConfigurationError("intents are required before connect"));
    }
    const connectGateway = this.#ports.connectGateway;
    if (connectGateway === undefined) {
      return Promise.reject(new ConfigurationError("Gateway connection is not configured"));
    }
    return this.#runConnect(intents, connectGateway);
  }

  disconnect(): Promise<void> {
    if (this.#session !== undefined) {
      this.#session.stop(1000);
      this.#session = undefined;
    }
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

  async #runConnect(intents: number, connectGateway: GatewayConnect): Promise<void> {
    const bot = await this.rest.getGatewayBot();
    const sessionOptions: SessionOptions = {
      url: bot.url,
      token: this.#options.token,
      intents,
      clock: this.#ports.clock,
      connect: connectGateway,
    };
    const shards = this.#options.shards;
    if (shards !== undefined && shards !== "recommended") {
      sessionOptions.shard = [shards.id, shards.count];
    }
    this.#session = await startSession(sessionOptions);
    await new Promise<void>(() => {});
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
