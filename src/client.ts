import type { GetGatewayBot } from "./decode/index.js";
import { CancelledError, ConfigurationError, DiscordHttpError, GatewayFatalError } from "./errors.js";
import type { GatewayConnect, Ports } from "./ports.js";
import { createRest, type RestSurface } from "./rest-surface.js";
import { startSession, type SessionHandle, type SessionOptions, type UnknownDispatch } from "./session.js";
import type { ClientOptions } from "./types.js";

export type { RestSurface };

type DispatchHandler = (payload: unknown) => void;

export class Client {
  readonly rest: RestSurface;
  readonly closed: Promise<void>;

  #ports: Ports;
  #options: ClientOptions;
  #session: SessionHandle | undefined;
  #resolveClosed = () => {};
  #rejectClosed = (_error: unknown) => {};
  #closedSettled = false;
  #live = false;
  #fatal: unknown | undefined;
  #tokenDeath: { error: DiscordHttpError | undefined } = { error: undefined };
  #resolveConnect: (() => void) | undefined;
  #rejectConnect: ((error: unknown) => void) | undefined;
  #unknownDispatchHandlers: DispatchHandler[] = [];
  #dispatchBindings: { t: string; handler: DispatchHandler }[] = [];
  #abortConnect: (() => void) | undefined;

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
    this.rest = createRest(ports.http, options.token, ports.clock, (error: unknown) => {
      if (error instanceof DiscordHttpError) {
        this.#onUnauthorized(error);
      }
    }, this.#tokenDeath);
  }

  on(dispatch: string, handler: DispatchHandler): () => void {
    const binding = { t: dispatch, handler };
    this.#dispatchBindings.push(binding);
    return () => {
      const remaining: { t: string; handler: DispatchHandler }[] = [];
      for (let index = 0; index < this.#dispatchBindings.length; index += 1) {
        const existing = this.#dispatchBindings[index];
        if (existing !== binding && existing !== undefined) {
          remaining.push(existing);
        }
      }
      this.#dispatchBindings = remaining;
    };
  }

  onUnknownDispatch(handler: DispatchHandler): () => void {
    this.#unknownDispatchHandlers.push(handler);
    return () => {
      const remaining: DispatchHandler[] = [];
      for (let index = 0; index < this.#unknownDispatchHandlers.length; index += 1) {
        const existing = this.#unknownDispatchHandlers[index];
        if (existing !== handler && existing !== undefined) {
          remaining.push(existing);
        }
      }
      this.#unknownDispatchHandlers = remaining;
    };
  }

  connect(options?: { signal?: AbortSignal }): Promise<void> {
    if (!this.#ports.gatewayEnabled) {
      return Promise.reject(
        new ConfigurationError("connect is not available on moon-discord/rest"),
      );
    }
    if (this.#fatal !== undefined) {
      return Promise.reject(this.#fatal);
    }
    if (this.#live) {
      return Promise.reject(new ConfigurationError("connect is already in progress"));
    }
    const intents = this.#options.intents;
    if (intents === undefined) {
      return Promise.reject(new ConfigurationError("intents are required before connect"));
    }
    const connectGateway = this.#ports.connectGateway;
    if (connectGateway === undefined) {
      return Promise.reject(new ConfigurationError("Gateway connection is not configured"));
    }
    const signal = options !== undefined && "signal" in options ? options.signal : undefined;
    if (signal !== undefined && signal.aborted) {
      return Promise.reject(new CancelledError("connect was aborted"));
    }
    this.#live = true;
    return this.#runConnect(intents, connectGateway, signal);
  }

  disconnect(): Promise<void> {
    this.#clearAbortConnect();
    this.#cancelConnect(new CancelledError("disconnect cancelled connect"));
    this.#stopSession();
    this.#live = false;
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

  async #runConnect(
    intents: number,
    connectGateway: GatewayConnect,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    if (signal !== undefined) {
      const onAbort = (): void => {
        this.#clearAbortConnect();
        this.#cancelConnect(new CancelledError("connect was aborted"));
        this.#stopSession();
        this.#live = false;
      };
      signal.addEventListener("abort", onAbort);
      this.#abortConnect = () => {
        signal.removeEventListener("abort", onAbort);
        this.#abortConnect = undefined;
      };
    }
    let bot: GetGatewayBot;
    try {
      bot = await this.rest.getGatewayBot(signal === undefined ? undefined : { signal });
    } catch (error: unknown) {
      this.#clearAbortConnect();
      this.#live = false;
      if (error instanceof Error && error instanceof DiscordHttpError && error.status === 401) {
        this.#haltToken(error);
        this.#settleClosedError(error);
      }
      throw error;
    }
    if (!this.#live) {
      throw new CancelledError("connect was aborted");
    }
    return new Promise((resolve, reject) => {
      this.#resolveConnect = () => {
        this.#resolveConnect = undefined;
        this.#rejectConnect = undefined;
        this.#clearAbortConnect();
        resolve();
      };
      this.#rejectConnect = (error: unknown) => {
        this.#resolveConnect = undefined;
        this.#rejectConnect = undefined;
        this.#clearAbortConnect();
        reject(error);
      };
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
        onDispatch: (payload) => {
          if (payload.t === "READY" || payload.t === "RESUMED") {
            this.#markSessionReady();
          }
          this.#emitDispatch(payload.t, payload.d);
        },
      };
      const shards = this.#options.shards;
      if (shards !== undefined && shards !== "recommended") {
        sessionOptions.shard = [shards.id, shards.count];
      }
      void startSession(sessionOptions).then(
        (handle) => {
          if (!this.#live) {
            handle.stop(1000);
            return;
          }
          this.#session = handle;
        },
        (error: unknown) => {
          this.#fail(error);
        },
      );
    });
  }

  #markSessionReady(): void {
    const resolveConnect = this.#resolveConnect;
    if (resolveConnect !== undefined) {
      resolveConnect();
    }
  }

  #onUnauthorized(error: DiscordHttpError): void {
    if (this.#session !== undefined || this.#rejectConnect !== undefined || this.#live) {
      this.#haltToken(error);
      this.#fail(error);
    }
  }

  #haltToken(error: DiscordHttpError): void {
    if (this.#tokenDeath.error === undefined) {
      this.#tokenDeath.error = error;
    }
  }

  #emitDispatch(t: string, payload: unknown): void {
    for (let index = 0; index < this.#dispatchBindings.length; index += 1) {
      const binding = this.#dispatchBindings[index];
      if (binding !== undefined && binding.t === t) {
        this.#runHandler(binding.handler, payload);
      }
    }
  }

  #emitUnknownDispatch(payload: UnknownDispatch): void {
    for (let index = 0; index < this.#unknownDispatchHandlers.length; index += 1) {
      const handler = this.#unknownDispatchHandlers[index];
      if (handler !== undefined) {
        this.#runHandler(handler, payload);
      }
    }
  }

  #runHandler(handler: DispatchHandler, payload: unknown): void {
    try {
      const result: unknown = handler(payload);
      if (result instanceof Promise) {
        result.then(undefined, () => {});
      }
    } catch {
      // Handler throws are isolated from Session and closed.
    }
  }

  #fail(error: unknown): void {
    if (error instanceof GatewayFatalError && error.closeCode === 4004 && this.#tokenDeath.error === undefined) {
      this.#haltToken(
        new DiscordHttpError({ status: 401, code: 0, message: "Gateway authentication failed" }),
      );
    }
    this.#fatal = error;
    this.#live = false;
    this.#settleClosedError(error);
    this.#cancelConnect(error);
    this.#stopSession();
  }

  #cancelConnect(error: unknown): void {
    const rejectConnect = this.#rejectConnect;
    if (rejectConnect !== undefined) {
      this.#resolveConnect = undefined;
      this.#rejectConnect = undefined;
      rejectConnect(error);
    }
  }

  #stopSession(): void {
    if (this.#session !== undefined) {
      this.#session.stop(1000);
      this.#session = undefined;
    }
  }

  #clearAbortConnect(): void {
    if (this.#abortConnect !== undefined) {
      this.#abortConnect();
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
    if (this.#fatal !== undefined) {
      return Promise.reject(this.#fatal);
    }
    return Promise.reject(new ConfigurationError("Gateway send requires connect() to have resolved"));
  }
}

export function createClient(options: ClientOptions, ports: Ports): Client {
  return new Client(options, ports);
}
