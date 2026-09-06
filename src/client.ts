import type { GetGatewayBot } from "./decode/index.js";
import {
  encodePresenceUpdate,
  encodeRequestChannelInfo,
  encodeRequestGuildMembers,
  encodeRequestSoundboardSounds,
  encodeVoiceStateUpdate,
  type PresenceUpdate,
  type RequestChannelInfo,
  type RequestGuildMembers,
  type RequestSoundboardSounds,
  type VoiceStateUpdate,
} from "./decode/gateway-send.js";
import {
  CancelledError,
  ConfigurationError,
  DiscordHttpError,
  GATEWAY_SESSION_WAIT_MS,
  GatewayFatalError,
  SaturatedError,
  TransportError,
} from "./errors.js";
import type { GatewayConnect, Ports } from "./ports.js";
import { fetchHttp } from "./fetch-http.js";
import { connectGatewayTransport } from "./gateway-transport.js";
import { createRest, type RestSurface } from "./rest-surface.js";
import { startSession, type SessionHandle, type SessionOptions, type UnknownDispatch } from "./session.js";
import { processOwnsGuild } from "./shard-membership.js";
import { systemClock } from "./system-clock.js";
import type { ClientOptions } from "./types.js";

export type { RestSurface };

type DispatchHandler = (payload: unknown) => void;

type SessionWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  cancelTimer: () => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

export class Client {
  readonly rest: RestSurface;
  readonly closed: Promise<void>;

  #ports: Ports;
  #options: ClientOptions;
  #session: SessionHandle | undefined;
  #resolveClosed = () => {};
  #rejectClosed = (_error: Error) => {};
  #closedSettled = false;
  #live = false;
  #fatal: Error | undefined;
  #tokenDeath: { error: DiscordHttpError | undefined } = { error: undefined };
  #resolveConnect: (() => void) | undefined;
  #rejectConnect: ((error: Error) => void) | undefined;
  #unknownDispatchHandlers: DispatchHandler[] = [];
  #dispatchBindings: { t: string; handler: DispatchHandler }[] = [];
  #connectAbortSignal: AbortSignal | undefined;
  #connectAbortHandler: (() => void) | undefined;
  #connectResolved = false;
  #sessionReady = false;
  #shardCount = 1;
  #ownedShardId = 0;
  #lastPresence: PresenceUpdate | undefined;
  #sessionWaiters: SessionWaiter[] = [];

  constructor(options: ClientOptions, ports: Ports) {
    let resolveClosed = () => {};
    let rejectClosed = (_error: Error) => {};
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
      if (error instanceof Error && error.name === "DiscordHttpError") {
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
    this.#connectResolved = false;
    this.#sessionReady = false;
    this.#lastPresence = undefined;
    this.#rejectSessionWaiters(new CancelledError("disconnect cancelled Gateway send"));
    this.#stopSession();
    this.#live = false;
    this.#settleClosedOk();
    return Promise.resolve();
  }

  updatePresence(presence: PresenceUpdate, options?: { signal?: AbortSignal }): Promise<void> {
    const early = this.#rejectGatewaySend();
    if (early !== undefined) {
      return early;
    }
    const encoded = encodePresenceUpdate(presence);
    if (utf8ByteLength(encoded.json) > 4096) {
      return Promise.reject(new ConfigurationError("Gateway payload exceeds 4096 UTF-8 bytes"));
    }
    this.#lastPresence = encoded.d;
    if (this.#session !== undefined) {
      this.#session.setIdentifyPresence(encoded.d);
    }
    if (!this.#sessionReady || this.#session === undefined) {
      return Promise.resolve();
    }
    const signal = options !== undefined && "signal" in options ? options.signal : undefined;
    return this.#session.enqueueApplication(encoded.json, signal);
  }

  updateVoiceState(voiceState: VoiceStateUpdate, options?: { signal?: AbortSignal }): Promise<void> {
    return this.#guildSend(voiceState.guild_id, encodeVoiceStateUpdate(voiceState), options);
  }

  requestGuildMembers(query: RequestGuildMembers, options?: { signal?: AbortSignal }): Promise<void> {
    if ("nonce" in query && utf8ByteLength(query.nonce) > 32) {
      return Promise.reject(new ConfigurationError("requestGuildMembers nonce exceeds 32 bytes"));
    }
    return this.#guildSend(query.guild_id, encodeRequestGuildMembers(query), options);
  }

  requestSoundboardSounds(query: RequestSoundboardSounds, options?: { signal?: AbortSignal }): Promise<void> {
    const early = this.#rejectGatewaySend();
    if (early !== undefined) {
      return early;
    }
    for (let index = 0; index < query.guild_ids.length; index += 1) {
      const guildId = query.guild_ids[index];
      if (guildId !== undefined && !this.#ownsGuild(guildId)) {
        return Promise.reject(new ConfigurationError("Gateway send targets a shard this process does not own"));
      }
    }
    return this.#enqueueAfterSessionReady(encodeRequestSoundboardSounds(query), options);
  }

  requestChannelInfo(query: RequestChannelInfo, options?: { signal?: AbortSignal }): Promise<void> {
    return this.#guildSend(query.guild_id, encodeRequestChannelInfo(query), options);
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
      this.#connectAbortSignal = signal;
      this.#connectAbortHandler = onAbort;
    }
    let bot: GetGatewayBot;
    try {
      bot = await this.rest.getGatewayBot(signal === undefined ? undefined : { signal });
    } catch (error: unknown) {
      this.#clearAbortConnect();
      this.#live = false;
      if (error instanceof Error && error.name === "DiscordHttpError") {
        this.#haltToken(
          new DiscordHttpError({ status: 401, code: 0, message: error.message }),
        );
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
      this.#rejectConnect = (error: Error) => {
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
          this.#failGateway(error);
        },
        onUnknownDispatch: (payload: UnknownDispatch) => {
          this.#emitUnknownDispatch(payload);
        },
        onReadyLost: () => {
          this.#sessionReady = false;
        },
        onDispatch: (payload) => {
          if (payload.t === "READY" || payload.t === "RESUMED") {
            this.#sessionReady = true;
            this.#resolveSessionWaiters();
            this.#markSessionReady();
          }
          this.#emitDispatch(payload.t, payload.d);
        },
      };
      const shards = this.#options.shards;
      if (shards !== undefined && shards !== "recommended") {
        sessionOptions.shard = [shards.id, shards.count];
        this.#shardCount = shards.count;
        this.#ownedShardId = shards.id;
      } else {
        this.#shardCount = bot.shards;
        this.#ownedShardId = 0;
      }
      void (async () => {
        try {
          const handle = await startSession(sessionOptions);
          if (!this.#live) {
            handle.stop(1000);
            return;
          }
          this.#session = handle;
        } catch (error: unknown) {
          this.#fail(error);
        }
      })();
    });
  }

  #markSessionReady(): void {
    this.#connectResolved = true;
    const resolveConnect = this.#resolveConnect;
    if (resolveConnect !== undefined) {
      resolveConnect();
    }
  }

  #onUnauthorized(error: Error): void {
    if (this.#session !== undefined || this.#rejectConnect !== undefined || this.#live) {
      this.#haltToken(
        new DiscordHttpError({ status: 401, code: 0, message: error.message }),
      );
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
        void result.then(() => {});
      }
    } catch {
      // Handler throws are isolated from Session and closed.
    }
  }

  #failGateway(error: GatewayFatalError): void {
    if (error.closeCode === 4004 && this.#tokenDeath.error === undefined) {
      this.#haltToken(
        new DiscordHttpError({ status: 401, code: 0, message: "Gateway authentication failed" }),
      );
    }
    this.#fatal = error;
    this.#live = false;
    this.#connectResolved = false;
    this.#sessionReady = false;
    this.#settleClosedError(error);
    this.#cancelConnect(error);
    this.#rejectSessionWaiters(error);
    this.#stopSession(error);
  }

  #fail(error: unknown): void {
    const fatal = error instanceof Error ? error : new TransportError();
    this.#fatal = fatal;
    this.#live = false;
    this.#connectResolved = false;
    this.#sessionReady = false;
    this.#settleClosedError(fatal);
    this.#cancelConnect(fatal);
    this.#rejectSessionWaiters(fatal);
    this.#stopSession(fatal);
  }

  #cancelConnect(error: Error): void {
    const rejectConnect = this.#rejectConnect;
    if (rejectConnect !== undefined) {
      this.#resolveConnect = undefined;
      this.#rejectConnect = undefined;
      rejectConnect(error);
    }
  }

  #stopSession(reason?: Error): void {
    if (this.#session !== undefined) {
      this.#session.stop(1000, reason);
      this.#session = undefined;
    }
  }

  #ownsGuild(guildId: string): boolean {
    return processOwnsGuild(guildId, this.#shardCount, this.#ownedShardId);
  }

  #guildSend(guildId: string, json: string, options?: { signal?: AbortSignal }): Promise<void> {
    const early = this.#rejectGatewaySend();
    if (early !== undefined) {
      return early;
    }
    if (!this.#ownsGuild(guildId)) {
      return Promise.reject(new ConfigurationError("Gateway send targets a shard this process does not own"));
    }
    return this.#enqueueAfterSessionReady(json, options);
  }

  async #enqueueAfterSessionReady(json: string, options?: { signal?: AbortSignal }): Promise<void> {
    if (utf8ByteLength(json) > 4096) {
      throw new ConfigurationError("Gateway payload exceeds 4096 UTF-8 bytes");
    }
    const signal = options !== undefined && "signal" in options ? options.signal : undefined;
    await this.#waitForSession(signal);
    if (this.#session === undefined) {
      throw new CancelledError("Gateway send was cancelled");
    }
    return this.#session.enqueueApplication(json, signal);
  }

  #waitForSession(signal: AbortSignal | undefined): Promise<void> {
    if (this.#sessionReady) {
      return Promise.resolve();
    }
    if (signal !== undefined && signal.aborted) {
      return Promise.reject(new CancelledError("Gateway send was aborted"));
    }
    return new Promise((resolve, reject) => {
      const waiter: SessionWaiter = {
        resolve,
        reject,
        cancelTimer: () => {},
      };
      waiter.cancelTimer = this.#ports.clock.schedule(GATEWAY_SESSION_WAIT_MS, () => {
        this.#removeSessionWaiter(waiter);
        reject(new SaturatedError({ kind: "gateway_session_wait" }));
      });
      if (signal !== undefined) {
        const onAbort = (): void => {
          waiter.cancelTimer();
          this.#removeSessionWaiter(waiter);
          if (signal !== undefined && waiter.onAbort !== undefined) {
            signal.removeEventListener("abort", waiter.onAbort);
          }
          reject(new CancelledError("Gateway send was aborted"));
        };
        signal.addEventListener("abort", onAbort);
        waiter.signal = signal;
        waiter.onAbort = onAbort;
      }
      this.#sessionWaiters.push(waiter);
    });
  }

  #removeSessionWaiter(target: SessionWaiter): void {
    const remaining: SessionWaiter[] = [];
    for (let index = 0; index < this.#sessionWaiters.length; index += 1) {
      const waiter = this.#sessionWaiters[index];
      if (waiter !== undefined && waiter !== target) {
        remaining.push(waiter);
      }
    }
    this.#sessionWaiters = remaining;
  }

  #resolveSessionWaiters(): void {
    const waiters = this.#sessionWaiters;
    this.#sessionWaiters = [];
    for (let index = 0; index < waiters.length; index += 1) {
      const waiter = waiters[index];
      if (waiter !== undefined) {
        waiter.cancelTimer();
        if (waiter.signal !== undefined && waiter.onAbort !== undefined) {
          waiter.signal.removeEventListener("abort", waiter.onAbort);
        }
        waiter.resolve();
      }
    }
  }

  #rejectSessionWaiters(error: Error): void {
    const waiters = this.#sessionWaiters;
    this.#sessionWaiters = [];
    for (let index = 0; index < waiters.length; index += 1) {
      const waiter = waiters[index];
      if (waiter !== undefined) {
        waiter.cancelTimer();
        if (waiter.signal !== undefined && waiter.onAbort !== undefined) {
          waiter.signal.removeEventListener("abort", waiter.onAbort);
        }
        waiter.reject(error);
      }
    }
  }

  #clearAbortConnect(): void {
    const signal = this.#connectAbortSignal;
    const handler = this.#connectAbortHandler;
    this.#connectAbortSignal = undefined;
    this.#connectAbortHandler = undefined;
    if (signal !== undefined && handler !== undefined) {
      signal.removeEventListener("abort", handler);
    }
  }

  #settleClosedError(error: Error): void {
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

  #rejectGatewaySend(): Promise<void> | undefined {
    if (!this.#ports.gatewayEnabled) {
      return Promise.reject(
        new ConfigurationError("Gateway send is not available on moon-discord/rest"),
      );
    }
    if (this.#fatal !== undefined) {
      return Promise.reject(this.#fatal);
    }
    if (!this.#connectResolved) {
      return Promise.reject(new ConfigurationError("Gateway send requires connect() to have resolved"));
    }
    return undefined;
  }
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function createClient(options: ClientOptions, ports: Ports): Client {
  return new Client(options, ports);
}
