import type { GetGatewayBot } from "./decode/index.js";
import { ConfigurationError, DiscordHttpError, GatewayFatalError } from "./errors.js";
import type { GatewayConnect, Ports } from "./ports.js";
import { createRest, type RestSurface } from "./rest-surface.js";
import { startSession, type SessionHandle, type SessionOptions, type UnknownDispatch } from "./session.js";
import type { ClientOptions } from "./types.js";

export type { RestSurface };

export class Client {
  readonly rest: RestSurface;
  readonly closed: Promise<void>;

  #ports: Ports;
  #options: ClientOptions;
  #session: SessionHandle | undefined;
  #resolveClosed = () => {};
  #rejectClosed = (_error: unknown) => {};
  #closedSettled = false;
  #rejectConnect: ((error: unknown) => void) | undefined;
  #unknownDispatchHandlers: ((payload: unknown) => void)[] = [];

  constructor(options: ClientOptions, ports: Ports) {
    let resolveClosed = () => {};
    let rejectClosed = (_error: unknown) => {};
    this.closed = new Promise((resolve, reject) => {
      resolveClosed = () => {
        resolve();
      };
      rejectClosed = (error: unknown) => {
        reject(error);
      };
    });
    this.#resolveClosed = resolveClosed;
    this.#rejectClosed = rejectClosed;
    this.#ports = ports;
    this.#options = options;
    this.rest = createRest(ports.http, options.token, ports.clock, (error) => {
      this.#onUnauthorized(error);
    });
  }

  on(_dispatch: string, _handler: (payload: unknown) => void): () => void {
    return () => {};
  }

  onUnknownDispatch(handler: (payload: unknown) => void): () => void {
    this.#unknownDispatchHandlers.push(handler);
    return () => {
      const remaining: ((payload: unknown) => void)[] = [];
      for (let index = 0; index < this.#unknownDispatchHandlers.length; index += 1) {
        const existing = this.#unknownDispatchHandlers[index];
        if (existing !== handler && existing !== undefined) {
          remaining.push(existing);
        }
      }
      this.#unknownDispatchHandlers = remaining;
    };
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
    this.#settleClosedOk();
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
    let bot: GetGatewayBot;
    try {
      bot = await this.rest.getGatewayBot();
    } catch (error: unknown) {
      if (error instanceof DiscordHttpError && error.status === 401) {
        this.#settleClosedError(error);
      }
      throw error;
    }
    return new Promise((_resolve, reject) => {
      this.#rejectConnect = reject;
      const sessionOptions: SessionOptions = {
        url: bot.url,
        token: this.#options.token,
        intents,
        clock: this.#ports.clock,
        connect: connectGateway,
        onFatal: (error: GatewayFatalError) => {
          this.#fail(error);
        },
        onUnknownDispatch: (payload: UnknownDispatch) => {
          this.#emitUnknownDispatch(payload);
        },
      };
      const shards = this.#options.shards;
      if (shards !== undefined && shards !== "recommended") {
        sessionOptions.shard = [shards.id, shards.count];
      }
      void startSession(sessionOptions).then(
        (handle) => {
          this.#session = handle;
        },
        (error: unknown) => {
          this.#fail(error);
        },
      );
    });
  }

  #onUnauthorized(error: DiscordHttpError): void {
    if (this.#session !== undefined || this.#rejectConnect !== undefined) {
      this.#fail(error);
    }
  }

  #emitUnknownDispatch(payload: UnknownDispatch): void {
    for (let index = 0; index < this.#unknownDispatchHandlers.length; index += 1) {
      const handler = this.#unknownDispatchHandlers[index];
      if (handler !== undefined) {
        handler(payload);
      }
    }
  }

  #fail(error: unknown): void {
    this.#settleClosedError(error);
    const rejectConnect = this.#rejectConnect;
    if (rejectConnect !== undefined) {
      this.#rejectConnect = undefined;
      rejectConnect(error);
    }
    if (this.#session !== undefined) {
      this.#session.stop(1000);
      this.#session = undefined;
    }
  }

  #settleClosedError(error: unknown): void {
    if (this.#closedSettled) {
      return;
    }
    this.#closedSettled = true;
    this.#rejectClosed(error);
  }

  #settleClosedOk(): void {
    if (this.#closedSettled) {
      return;
    }
    this.#closedSettled = true;
    this.#resolveClosed();
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
