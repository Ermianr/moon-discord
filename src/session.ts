import {
  decodeChannelInfo,
  decodeGuildMembersChunk,
  decodeMessage,
  decodeRateLimited,
  decodeReady,
  decodeResumed,
  decodeSoundboardSounds,
} from "./decode/index.js";
import type { PresenceUpdate } from "./decode/gateway-send.js";
import { CancelledError, GATEWAY_SEND_QUEUE, GatewayFatalError, SaturatedError } from "./errors.js";
import type { Clock, GatewayConnect, GatewayConnection } from "./ports.js";

export type UnknownDispatch = { t: string; d: unknown };

export type SessionOptions = {
  url: string;
  token: string;
  intents: number;
  clock: Clock;
  connect: GatewayConnect;
  shard?: [number, number];
  onFatal: (error: GatewayFatalError) => void;
  onUnknownDispatch: (payload: UnknownDispatch) => void;
  onDispatch: (payload: { t: string; d: unknown }) => void;
  onReadyLost: () => void;
};

export type SessionHandle = {
  stop: (code: number, reason?: Error) => void;
  enqueueApplication: (text: string, signal?: AbortSignal) => Promise<void>;
  setIdentifyPresence: (presence: PresenceUpdate | undefined) => void;
};

const OP_DISPATCH = 0;
const OP_HEARTBEAT = 1;
const OP_IDENTIFY = 2;
const OP_RESUME = 6;
const OP_RECONNECT = 7;
const OP_INVALID_SESSION = 9;
const OP_HELLO = 10;
const OP_HEARTBEAT_ACK = 11;

const CLOSE_PROTOCOL = 4000;
const IDENTIFY_BACKOFF_START_MS = 1_000;
const IDENTIFY_BACKOFF_CAP_MS = 32_000;

function identifyOs(): string {
  if (process.platform.length > 0) {
    return process.platform;
  }
  return "linux";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFatalCloseCode(code: number): boolean {
  return code === 4004 || code === 4010 || code === 4011 || code === 4012 || code === 4013 || code === 4014;
}

export async function startSession(options: SessionOptions): Promise<SessionHandle> {
  let connection: GatewayConnection | undefined;
  let cancelHeartbeat: (() => void) | undefined;
  let cancelBackoff: (() => void) | undefined;
  let sequence: number | null = null;
  let heartbeatIntervalMs = 0;
  let authed = false;
  let awaitingAck = false;
  let resumeThisConnection = false;
  let sessionId: string | undefined;
  let resumeGatewayUrl: string | undefined;
  let identifyBackoffMs = IDENTIFY_BACKOFF_START_MS;
  let stopped = false;
  let reconnecting = false;
  let pendingTexts: string[] = [];
  let identifyPresence: PresenceUpdate | undefined;
  let applicationReady = false;
  let cancelPace: (() => void) | undefined;
  type AppSend = {
    text: string;
    resolve: () => void;
    reject: (error: Error) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
  };
  let appQueue: AppSend[] = [];
  let sentAt: number[] = [];

  const clearHeartbeat = (): void => {
    if (cancelHeartbeat !== undefined) {
      cancelHeartbeat();
      cancelHeartbeat = undefined;
    }
  };

  const clearBackoff = (): void => {
    if (cancelBackoff !== undefined) {
      cancelBackoff();
      cancelBackoff = undefined;
    }
  };

  const hasSession = (): boolean => {
    return sessionId !== undefined && resumeGatewayUrl !== undefined;
  };

  const invalidateSession = (): void => {
    sessionId = undefined;
    resumeGatewayUrl = undefined;
  };

  const selfClose = (code: number): void => {
    reconnecting = true;
    clearHeartbeat();
    const current = connection;
    connection = undefined;
    if (current !== undefined) {
      current.close(code);
    }
  };

  const sendIdentify = (): void => {
    if (connection === undefined) {
      return;
    }
    const data: {
      token: string;
      intents: number;
      properties: { os: string; browser: string; device: string };
      shard?: [number, number];
      presence?: PresenceUpdate;
    } = {
      token: options.token,
      intents: options.intents,
      properties: {
        os: identifyOs(),
        browser: "moon-discord",
        device: "moon-discord",
      },
    };
    if (options.shard !== undefined) {
      data.shard = options.shard;
    }
    if (identifyPresence !== undefined) {
      data.presence = identifyPresence;
    }
    connection.sendText(JSON.stringify({ op: OP_IDENTIFY, d: data }));
  };

  const sendResume = (): void => {
    if (connection === undefined || sessionId === undefined) {
      return;
    }
    connection.sendText(
      JSON.stringify({
        op: OP_RESUME,
        d: { token: options.token, session_id: sessionId, seq: sequence },
      }),
    );
  };

  const sendHandshake = (): void => {
    if (connection === undefined || authed) {
      return;
    }
    authed = true;
    if (resumeThisConnection && sessionId !== undefined) {
      sendResume();
      return;
    }
    sendIdentify();
  };

  const sendHeartbeat = (immediate: boolean): boolean => {
    if (connection === undefined) {
      return true;
    }
    if (awaitingAck && !immediate) {
      return false;
    }
    connection.sendText(JSON.stringify({ op: OP_HEARTBEAT, d: sequence }));
    awaitingAck = true;
    return true;
  };

  const scheduleNextHeartbeat = (delayMs: number): void => {
    clearHeartbeat();
    cancelHeartbeat = options.clock.schedule(delayMs, () => {
      if (!sendHeartbeat(false)) {
        beginResumeOrIdentifyNow(CLOSE_PROTOCOL);
        return;
      }
      sendHandshake();
      if (heartbeatIntervalMs > 0) {
        scheduleNextHeartbeat(heartbeatIntervalMs);
      }
    });
  };

  const onHello = (data: unknown): void => {
    if (!isRecord(data)) {
      return;
    }
    const interval = data["heartbeat_interval"];
    if (typeof interval !== "number") {
      return;
    }
    heartbeatIntervalMs = interval;
    scheduleNextHeartbeat(interval * Math.random());
  };

  const rememberSequence = (payload: Record<string, unknown>): void => {
    const s = payload["s"];
    if (typeof s === "number") {
      sequence = s;
    }
  };

  const emitDecoded = (t: string, d: unknown, decode: (value: unknown) => unknown): void => {
    try {
      options.onDispatch({ t, d: decode(d) });
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "DecodeError") {
        options.onUnknownDispatch({ t, d });
        return;
      }
      throw error;
    }
  };

  const onDispatch = (payload: Record<string, unknown>): void => {
    const t = payload["t"];
    if (typeof t !== "string") {
      beginProtocolFailure();
      return;
    }
    const d = payload["d"];
    if (t === "READY") {
      try {
        const ready = decodeReady(d);
        sessionId = ready.session_id;
        resumeGatewayUrl = ready.resume_gateway_url;
        identifyBackoffMs = IDENTIFY_BACKOFF_START_MS;
        applicationReady = true;
        options.onDispatch({ t, d: ready });
        drainApplication();
      } catch (error: unknown) {
        if (error instanceof Error && error.name === "DecodeError") {
          options.onUnknownDispatch({ t, d });
          return;
        }
        throw error;
      }
      return;
    }
    if (t === "RESUMED") {
      try {
        const resumed = decodeResumed(d);
        identifyBackoffMs = IDENTIFY_BACKOFF_START_MS;
        applicationReady = true;
        options.onDispatch({ t, d: resumed });
        drainApplication();
      } catch (error: unknown) {
        if (error instanceof Error && error.name === "DecodeError") {
          options.onUnknownDispatch({ t, d });
          return;
        }
        throw error;
      }
      return;
    }
    if (t === "MESSAGE_CREATE") {
      try {
        const message = decodeMessage(d);
        options.onDispatch({ t, d: message });
      } catch (error: unknown) {
        if (error instanceof Error && error.name === "DecodeError") {
          options.onUnknownDispatch({ t, d });
          return;
        }
        throw error;
      }
      return;
    }
    if (t === "GUILD_MEMBERS_CHUNK") {
      emitDecoded("GUILD_MEMBERS_CHUNK", d, decodeGuildMembersChunk);
      return;
    }
    if (t === "RATE_LIMITED") {
      emitDecoded("RATE_LIMITED", d, decodeRateLimited);
      return;
    }
    if (t === "CHANNEL_INFO") {
      emitDecoded("CHANNEL_INFO", d, decodeChannelInfo);
      return;
    }
    if (t === "SOUNDBOARD_SOUNDS") {
      emitDecoded("SOUNDBOARD_SOUNDS", d, decodeSoundboardSounds);
      return;
    }
    options.onUnknownDispatch({ t, d });
  };

  const onText = (text: string): void => {
    if (connection === undefined) {
      pendingTexts.push(text);
      return;
    }
    deliverText(text);
  };

  const deliverText = (text: string): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      beginProtocolFailure();
      return;
    }
    if (!isRecord(parsed)) {
      beginProtocolFailure();
      return;
    }
    const op = parsed["op"];
    if (typeof op !== "number") {
      beginProtocolFailure();
      return;
    }
    rememberSequence(parsed);
    if (op === OP_HELLO) {
      onHello(parsed["d"]);
      return;
    }
    if (op === OP_HEARTBEAT_ACK) {
      awaitingAck = false;
      return;
    }
    if (op === OP_HEARTBEAT) {
      sendHeartbeat(true);
      return;
    }
    if (op === OP_RECONNECT) {
      beginResumeOrIdentifyNow(CLOSE_PROTOCOL);
      return;
    }
    if (op === OP_INVALID_SESSION) {
      const resumable = parsed["d"] === true;
      if (resumable) {
        beginResumeOrIdentifyNow(CLOSE_PROTOCOL);
        return;
      }
      beginIdentifyBackoff(CLOSE_PROTOCOL);
      return;
    }
    if (op === OP_DISPATCH) {
      onDispatch(parsed);
    }
  };

  const onClose = (code: number | undefined): void => {
    clearHeartbeat();
    if (stopped) {
      return;
    }
    if (reconnecting) {
      return;
    }
    if (code !== undefined && isFatalCloseCode(code)) {
      stopped = true;
      options.onFatal(new GatewayFatalError({ closeCode: code }));
      return;
    }
    if (code === 1000 || code === 1001) {
      invalidateSession();
      return;
    }
    if (code === 4007 || code === 4009) {
      beginIdentifyBackoff(undefined);
      return;
    }
    beginResumeOrIdentifyNow(undefined);
  };

  const openGateway = async (url: string, resume: boolean): Promise<void> => {
    if (stopped) {
      return;
    }
    clearBackoff();
    resumeThisConnection = resume;
    authed = false;
    awaitingAck = false;
    heartbeatIntervalMs = 0;
    pendingTexts = [];
    const next = await options.connect(url, {
      onText,
      onClose,
      onError: () => {},
    });
    if (stopped) {
      next.close(1000);
      return;
    }
    connection = next;
    reconnecting = false;
    drainApplication();
    const queued = pendingTexts;
    pendingTexts = [];
    for (let index = 0; index < queued.length; index += 1) {
      const text = queued[index];
      if (text !== undefined) {
        deliverText(text);
      }
    }
  };

  const markReadyLost = (): void => {
    if (applicationReady) {
      applicationReady = false;
      options.onReadyLost();
    }
  };

  const beginResumeOrIdentifyNow = (closeCode: number | undefined): void => {
    if (stopped || reconnecting) {
      return;
    }
    markReadyLost();
    if (closeCode !== undefined) {
      selfClose(closeCode);
    } else {
      reconnecting = true;
      clearHeartbeat();
      connection = undefined;
    }
    const resumeUrl = resumeGatewayUrl;
    const id = sessionId;
    if (id !== undefined && resumeUrl !== undefined) {
      void openGateway(resumeUrl, true);
      return;
    }
    void openGateway(options.url, false);
  };

  const beginIdentifyBackoff = (closeCode: number | undefined): void => {
    if (stopped || reconnecting) {
      return;
    }
    markReadyLost();
    invalidateSession();
    if (closeCode !== undefined) {
      selfClose(closeCode);
    } else {
      reconnecting = true;
      clearHeartbeat();
      connection = undefined;
    }
    reconnecting = false;
    const delay = identifyBackoffMs;
    const doubled = delay * 2;
    identifyBackoffMs = doubled > IDENTIFY_BACKOFF_CAP_MS ? IDENTIFY_BACKOFF_CAP_MS : doubled;
    const wait = delay * (1 + Math.random());
    cancelBackoff = options.clock.schedule(wait, () => {
      cancelBackoff = undefined;
      if (stopped) {
        return;
      }
      void openGateway(options.url, false);
    });
  };

  const beginProtocolFailure = (): void => {
    if (stopped || reconnecting) {
      return;
    }
    if (hasSession()) {
      beginResumeOrIdentifyNow(CLOSE_PROTOCOL);
      return;
    }
    beginIdentifyBackoff(CLOSE_PROTOCOL);
  };

  const detachJob = (job: AppSend): void => {
    if (job.signal !== undefined && job.onAbort !== undefined) {
      job.signal.removeEventListener("abort", job.onAbort);
    }
  };

  const rejectQueue = (error: Error): void => {
    const pending = appQueue;
    appQueue = [];
    for (let index = 0; index < pending.length; index += 1) {
      const job = pending[index];
      if (job !== undefined) {
        detachJob(job);
        job.reject(error);
      }
    }
  };

  const pruneSent = (now: number): void => {
    const cutoff = now - 60_000;
    const kept: number[] = [];
    for (let index = 0; index < sentAt.length; index += 1) {
      const at = sentAt[index];
      if (at !== undefined && at > cutoff) {
        kept.push(at);
      }
    }
    sentAt = kept;
  };

  const drainApplication = (): void => {
    if (cancelPace !== undefined) {
      cancelPace();
      cancelPace = undefined;
    }
    if (stopped || !applicationReady) {
      return;
    }
    while (appQueue.length > 0) {
      if (connection === undefined) {
        return;
      }
      const now = options.clock.nowMs();
      pruneSent(now);
      if (sentAt.length >= GATEWAY_SEND_QUEUE) {
        const oldest = sentAt[0];
        if (oldest === undefined) {
          return;
        }
        const wait = oldest + 60_000 - now;
        if (wait > 0) {
          cancelPace = options.clock.schedule(wait, () => {
            cancelPace = undefined;
            drainApplication();
          });
          return;
        }
      }
      const job = appQueue[0];
      if (job === undefined) {
        return;
      }
      const rest: AppSend[] = [];
      for (let index = 1; index < appQueue.length; index += 1) {
        const nextJob = appQueue[index];
        if (nextJob !== undefined) {
          rest.push(nextJob);
        }
      }
      appQueue = rest;
      detachJob(job);
      connection.sendText(job.text);
      sentAt.push(options.clock.nowMs());
      job.resolve();
    }
  };

  const removeJob = (target: AppSend): void => {
    const remaining: AppSend[] = [];
    for (let index = 0; index < appQueue.length; index += 1) {
      const job = appQueue[index];
      if (job !== undefined && job !== target) {
        remaining.push(job);
      }
    }
    appQueue = remaining;
  };

  const enqueueApplication = (text: string, signal?: AbortSignal): Promise<void> => {
    if (stopped) {
      return Promise.reject(new CancelledError("Gateway send was cancelled"));
    }
    if (signal !== undefined && signal.aborted) {
      return Promise.reject(new CancelledError("Gateway send was aborted"));
    }
    if (appQueue.length >= GATEWAY_SEND_QUEUE) {
      return Promise.reject(new SaturatedError({ kind: "gateway_queue" }));
    }
    return new Promise((resolve, reject) => {
      const job: AppSend = { text, resolve, reject };
      if (signal !== undefined) {
        const onAbort = (): void => {
          removeJob(job);
          detachJob(job);
          reject(new CancelledError("Gateway send was aborted"));
        };
        signal.addEventListener("abort", onAbort);
        job.signal = signal;
        job.onAbort = onAbort;
      }
      appQueue.push(job);
      drainApplication();
    });
  };

  const stop = (code: number, reason?: Error): void => {
    stopped = true;
    markReadyLost();
    clearHeartbeat();
    clearBackoff();
    if (cancelPace !== undefined) {
      cancelPace();
      cancelPace = undefined;
    }
    rejectQueue(reason === undefined ? new CancelledError("disconnect cancelled Gateway send") : reason);
    const current = connection;
    connection = undefined;
    if (current !== undefined) {
      current.close(code);
    }
  };

  await openGateway(options.url, false);
  return {
    stop,
    enqueueApplication,
    setIdentifyPresence: (presence) => {
      identifyPresence = presence;
    },
  };
}
