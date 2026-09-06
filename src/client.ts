import type { GetGatewayBot } from "./decode/index.js";
import type { DispatchHandler, InteractionCreateHandler, MessageCreateHandler } from "./dispatch-handlers.js";
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
import type { Clock, GatewayConnect, Ports } from "./ports.js";
import { fetchHttp } from "./fetch-http.js";
import { connectGatewayTransport } from "./gateway-transport.js";
import { createRest, type ApplicationIdentity, type RestSurface } from "./rest-surface.js";
import { startSession, type SessionHandle, type SessionOptions, type UnknownDispatch } from "./session.js";
import { processOwnsGuild } from "./shard-membership.js";
import { systemClock } from "./system-clock.js";
import type { ClientOptions } from "./types.js";

export type { RestSurface };

const idleSession: SessionHandle = {
  stop: () => {},
  enqueueApplication: (_text, _signal) => Promise.resolve(),
  setIdentifyPresence: () => {},
};

const idlePresence: PresenceUpdate = {
  since: null,
  activities: [],
  status: "online",
  afk: false,
};

type SessionWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  cancelTimer: () => void;
  detachAbort: () => void;
};

const idleConnectGateway: GatewayConnect = (_url, _handlers) => {
  return Promise.reject(new ConfigurationError("Gateway connection is not configured"));
};

export class Client {
  readonly rest: RestSurface;
  readonly closed: Promise<void>;

  #token: string;
  #intents = 0;
  #hasIntents = false;
  #shardExplicit = false;
  #explicitShardId = 0;
  #explicitShardCount = 1;
  #clock: Clock;
  #gatewayEnabled = true;
  #connectGateway: GatewayConnect = idleConnectGateway;
  #session: SessionHandle = idleSession;
  #hasSession = false;
  #resolveClosed = () => {};
  #rejectClosed = (_error: Error) => {};
  #closedSettled = false;
  #live = false;
  #hasFatal = false;
  #fatal: Error = new TransportError();
  #tokenDeath = {
    dead: false,
    error: new DiscordHttpError({ status: 0, code: 0, message: "" }),
  };
  #hasConnectWaiter = false;
  #resolveConnect = () => {};
  #rejectConnect = (_error: Error) => {};
  #catchallHandlers: DispatchHandler[] = [];
  #dispatchBindings: { t: string; handler: DispatchHandler }[] = [];
  #clearConnectAbort = () => {};
  #connectResolved = false;
  #sessionReady = false;
  #shardCount = 1;
  #ownedShardId = 0;
  #hasLastPresence = false;
  #lastPresence: PresenceUpdate = idlePresence;
  #sessionWaiters: SessionWaiter[] = [];
  #applicationIdentity: ApplicationIdentity = { id: undefined };
  #publicKey: string | undefined;
  #httpIngestUsed = false;
  #gatewayReceiveUsed = false;

  constructor(options: ClientOptions, ports?: Ports) {
    let resolveClosed = () => {};
    let rejectClosed = (_error: Error) => {};
    this.closed = new Promise((resolve, reject) => {
      resolveClosed = () => {
        resolve();
      };
      rejectClosed = (error: Error) => {
        reject(error);
      };
    });
    this.#resolveClosed = resolveClosed;
    this.#rejectClosed = rejectClosed;
    this.#token = options.token;
    if ("publicKey" in options && options.publicKey !== undefined) {
      this.#publicKey = options.publicKey;
    }
    if (options.intents !== undefined) {
      this.#intents = options.intents;
      this.#hasIntents = true;
    }
    const shards = options.shards;
    if (shards !== undefined && shards !== "recommended") {
      this.#shardExplicit = true;
      this.#explicitShardId = shards.id;
      this.#explicitShardCount = shards.count;
    }
    const resolvedPorts: Ports =
      ports !== undefined
        ? ports
        : {
            http: fetchHttp(),
            clock: systemClock(),
            gatewayEnabled: true,
            connectGateway: connectGatewayTransport,
          };
    this.#clock = resolvedPorts.clock;
    this.#gatewayEnabled = resolvedPorts.gatewayEnabled;
    this.#connectGateway =
      resolvedPorts.connectGateway !== undefined ? resolvedPorts.connectGateway : idleConnectGateway;
    this.rest = createRest(resolvedPorts.http, options.token, resolvedPorts.clock, (error: Error) => {
      if (error instanceof Error && error.name === "DiscordHttpError") {
        this.#onUnauthorized(error);
      }
    }, this.#tokenDeath, this.#applicationIdentity);
  }

  on(dispatch: "MESSAGE_CREATE", handler: MessageCreateHandler): () => void;
  on(dispatch: "INTERACTION_CREATE", handler: InteractionCreateHandler): () => void;
  on(dispatch: string, handler: DispatchHandler): () => void;
  on(dispatch: string, handler: MessageCreateHandler | InteractionCreateHandler | DispatchHandler): () => void {
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
    this.#catchallHandlers.push(handler);
    return () => {
      const remaining: DispatchHandler[] = [];
      for (let index = 0; index < this.#catchallHandlers.length; index += 1) {
        const existing = this.#catchallHandlers[index];
        if (existing !== handler && existing !== undefined) {
          remaining.push(existing);
        }
      }
      this.#catchallHandlers = remaining;
    };
  }

  connect(options?: { signal?: AbortSignal }): Promise<void> {
    if (!this.#gatewayEnabled) {
      return rejectWith(
        new ConfigurationError("connect is not available on moon-discord/rest"),
      );
    }
    if (this.#hasFatal) {
      return rejectWith(this.#fatal);
    }
    if (this.#live) {
      return rejectWith(new ConfigurationError("connect is already in progress"));
    }
    if (!this.#hasIntents) {
      return rejectWith(new ConfigurationError("intents are required before connect"));
    }
    if (this.#httpIngestUsed) {
      return rejectWith(
        new ConfigurationError("connect and handleInteractionRequest cannot be used on the same Client"),
      );
    }
    const signal = options !== undefined ? options.signal : undefined;
    if (signal !== undefined && signal.aborted) {
      return rejectWith(new CancelledError("connect was aborted"));
    }
    this.#live = true;
    this.#gatewayReceiveUsed = true;
    return this.#runConnect(this.#intents, this.#connectGateway, signal);
  }

  disconnect(): Promise<void> {
    this.#clearAbortConnect();
    this.#cancelConnect(new CancelledError("disconnect cancelled connect"));
    this.#connectResolved = false;
    this.#sessionReady = false;
    this.#hasLastPresence = false;
    this.#lastPresence = idlePresence;
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
      return rejectWith(new ConfigurationError("Gateway payload exceeds 4096 UTF-8 bytes"));
    }
    this.#hasLastPresence = true;
    this.#lastPresence = encoded.d;
    if (this.#hasSession) {
      this.#session.setIdentifyPresence(encoded.d);
    }
    if (!this.#sessionReady || !this.#hasSession) {
      return Promise.resolve();
    }
    const signal = options !== undefined ? options.signal : undefined;
    return this.#session.enqueueApplication(encoded.json, signal);
  }

  updateVoiceState(voiceState: VoiceStateUpdate, options?: { signal?: AbortSignal }): Promise<void> {
    return this.#guildSend(voiceState.guild_id, encodeVoiceStateUpdate(voiceState), options);
  }

  requestGuildMembers(query: RequestGuildMembers, options?: { signal?: AbortSignal }): Promise<void> {
    if ("nonce" in query && utf8ByteLength(query.nonce) > 32) {
      return rejectWith(new ConfigurationError("requestGuildMembers nonce exceeds 32 bytes"));
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
        return rejectWith(new ConfigurationError("Gateway send targets a shard this process does not own"));
      }
    }
    return this.#enqueueAfterSessionReady(encodeRequestSoundboardSounds(query), options);
  }

  requestChannelInfo(query: RequestChannelInfo, options?: { signal?: AbortSignal }): Promise<void> {
    return this.#guildSend(query.guild_id, encodeRequestChannelInfo(query), options);
  }

  handleInteractionRequest(_request: { body: string; headers: Record<string, string> }): Promise<{
    status: number;
    body: string;
  }> {
    if (this.#gatewayReceiveUsed) {
      return Promise.reject(
        new ConfigurationError("connect and handleInteractionRequest cannot be used on the same Client"),
      );
    }
    this.#httpIngestUsed = true;
    if (this.#publicKey === undefined) {
      return Promise.reject(new ConfigurationError("publicKey is required to handle interaction requests"));
    }
    return Promise.reject(new ConfigurationError("HTTP interaction ingest is not available until 1.x"));
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
      this.#clearConnectAbort = () => {
        signal.removeEventListener("abort", onAbort);
        this.#clearConnectAbort = () => {};
      };
    }
    let bot: GetGatewayBot;
    try {
      bot = await this.rest.getGatewayBot(signal === undefined ? undefined : { signal });
    } catch (error) {
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
        this.#hasConnectWaiter = false;
        this.#resolveConnect = () => {};
        this.#rejectConnect = (_error: Error) => {};
        this.#clearAbortConnect();
        resolve();
      };
      this.#rejectConnect = (error: Error) => {
        this.#hasConnectWaiter = false;
        this.#resolveConnect = () => {};
        this.#rejectConnect = (_error: Error) => {};
        this.#clearAbortConnect();
        reject(error);
      };
      this.#hasConnectWaiter = true;
      const sessionOptions: SessionOptions = {
        url: bot.url,
        token: this.#token,
        intents,
        clock: this.#clock,
        connect: connectGateway,
        onFatal: (closeCode: number) => {
          this.#failGateway(closeCode);
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
          if (payload.t === "READY") {
            this.#rememberApplication(payload.d);
          }
          this.#emitDispatch(payload.t, payload.d);
        },
      };
      if (this.#shardExplicit) {
        sessionOptions.shard = [this.#explicitShardId, this.#explicitShardCount];
        this.#shardCount = this.#explicitShardCount;
        this.#ownedShardId = this.#explicitShardId;
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
          this.#hasSession = true;
          if (this.#hasLastPresence) {
            handle.setIdentifyPresence(this.#lastPresence);
          }
        } catch (error) {
          if (error instanceof Error) {
            this.#fail(error);
          } else {
            this.#fail(new TransportError());
          }
        }
      })();
    });
  }

  #markSessionReady(): void {
    this.#connectResolved = true;
    if (this.#hasConnectWaiter) {
      this.#resolveConnect();
    }
  }

  #onUnauthorized(error: Error): void {
    if (this.#hasSession || this.#hasConnectWaiter || this.#live) {
      this.#haltToken(
        new DiscordHttpError({ status: 401, code: 0, message: error.message }),
      );
      this.#fail(error);
    }
  }

  #rememberApplication(payload: object): void {
    if (!("application" in payload)) {
      return;
    }
    const application = payload.application;
    if (typeof application !== "object" || application === null || Array.isArray(application) || !("id" in application)) {
      return;
    }
    const id = application.id;
    if (typeof id === "string") {
      this.#applicationIdentity.id = id;
    }
  }

  #haltToken(error: DiscordHttpError): void {
    if (!this.#tokenDeath.dead) {
      this.#tokenDeath.dead = true;
      this.#tokenDeath.error = error;
    }
  }

  #emitDispatch(t: string, payload: object): void {
    for (let index = 0; index < this.#dispatchBindings.length; index += 1) {
      const binding = this.#dispatchBindings[index];
      if (binding !== undefined && binding.t === t) {
        this.#runHandler(binding.handler, payload);
      }
    }
  }

  #emitUnknownDispatch(payload: UnknownDispatch): void {
    for (let index = 0; index < this.#catchallHandlers.length; index += 1) {
      const handler = this.#catchallHandlers[index];
      if (handler !== undefined) {
        this.#runHandler(handler, payload);
      }
    }
  }

  #runHandler(handler: DispatchHandler, payload: object): void {
    try {
      const result = handler(payload);
      if (result instanceof Promise) {
        result.then(
          () => {},
          () => {},
        );
      }
    } catch {
      // Handler throws are isolated from Session and closed.
    }
  }

  #failGateway(closeCode: number): void {
    if (closeCode === 4004 && !this.#tokenDeath.dead) {
      this.#haltToken(
        new DiscordHttpError({ status: 401, code: 0, message: "Gateway authentication failed" }),
      );
    }
    this.#fail(new GatewayFatalError({ closeCode }));
  }

  #fail(error: Error): void {
    const fatal = error;
    this.#hasFatal = true;
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
    if (this.#hasConnectWaiter) {
      this.#rejectConnect(error);
    }
  }

  #stopSession(reason?: Error): void {
    if (this.#hasSession) {
      this.#session.stop(1000);
      this.#session = idleSession;
      this.#hasSession = false;
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
      return rejectWith(new ConfigurationError("Gateway send targets a shard this process does not own"));
    }
    return this.#enqueueAfterSessionReady(json, options);
  }

  async #enqueueAfterSessionReady(json: string, options?: { signal?: AbortSignal }): Promise<void> {
    if (utf8ByteLength(json) > 4096) {
      throw new ConfigurationError("Gateway payload exceeds 4096 UTF-8 bytes");
    }
    const signal = options !== undefined ? options.signal : undefined;
    await this.#waitForSession(signal);
    if (!this.#hasSession) {
      throw new CancelledError("Gateway send was cancelled");
    }
    return this.#session.enqueueApplication(json, signal);
  }

  #waitForSession(signal: AbortSignal | undefined): Promise<void> {
    if (this.#sessionReady) {
      return Promise.resolve();
    }
    if (signal !== undefined && signal.aborted) {
      return rejectWith(new CancelledError("Gateway send was aborted"));
    }
    return new Promise((resolve, reject) => {
      const waiter: SessionWaiter = {
        resolve,
        reject,
        cancelTimer: () => {},
        detachAbort: () => {},
      };
      waiter.cancelTimer = this.#clock.schedule(GATEWAY_SESSION_WAIT_MS, () => {
        this.#removeSessionWaiter(waiter);
        reject(new SaturatedError({ kind: "gateway_session_wait" }));
      });
      waiter.detachAbort = () => {};
      if (signal !== undefined) {
        const onAbort = (): void => {
          waiter.cancelTimer();
          this.#removeSessionWaiter(waiter);
          waiter.detachAbort();
          reject(new CancelledError("Gateway send was aborted"));
        };
        signal.addEventListener("abort", onAbort);
        waiter.detachAbort = () => {
          signal.removeEventListener("abort", onAbort);
          waiter.detachAbort = () => {};
        };
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
        waiter.detachAbort();
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
        waiter.detachAbort();
        waiter.reject(error);
      }
    }
  }

  #clearAbortConnect(): void {
    this.#clearConnectAbort();
    this.#clearConnectAbort = () => {};
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
    if (!this.#gatewayEnabled) {
      return rejectWith(
        new ConfigurationError("Gateway send is not available on moon-discord/rest"),
      );
    }
    if (this.#hasFatal) {
      return rejectWith(this.#fatal);
    }
    if (!this.#connectResolved) {
      return rejectWith(new ConfigurationError("Gateway send requires connect() to have resolved"));
    }
    return undefined;
  }
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function rejectWith(error: Error): Promise<void> {
  return new Promise((_resolve, reject: (reason: Error) => void) => {
    reject(error);
  });
}

export function createClient(options: ClientOptions, ports: Ports): Client {
  return new Client(options, ports);
}
