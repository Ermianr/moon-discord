import { decodeMessage, decodeReady } from "./decode/index.js";
import { DecodeError, GatewayFatalError } from "./errors.js";
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
};

export type SessionHandle = {
  stop: (code: number) => void;
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
  if (typeof process.platform === "string" && process.platform.length > 0) {
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
      return false;
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
    if (!isRecord(data) || !("heartbeat_interval" in data)) {
      return;
    }
    const interval = data.heartbeat_interval;
    if (typeof interval !== "number") {
      return;
    }
    heartbeatIntervalMs = interval;
    scheduleNextHeartbeat(interval * Math.random());
  };

  const rememberSequence = (payload: Record<string, unknown>): void => {
    if (!("s" in payload)) {
      return;
    }
    const s = payload.s;
    if (typeof s === "number") {
      sequence = s;
    }
  };

  const onDispatch = (payload: Record<string, unknown>): void => {
    if (!("t" in payload) || typeof payload.t !== "string") {
      beginProtocolFailure();
      return;
    }
    const t = payload.t;
    const d = "d" in payload ? payload.d : undefined;
    if (t === "READY") {
      try {
        const ready = decodeReady(d);
        sessionId = ready.session_id;
        resumeGatewayUrl = ready.resume_gateway_url;
        identifyBackoffMs = IDENTIFY_BACKOFF_START_MS;
      } catch (error: unknown) {
        if (error instanceof DecodeError) {
          options.onUnknownDispatch({ t, d });
          return;
        }
        throw error;
      }
      return;
    }
    if (t === "MESSAGE_CREATE") {
      try {
        decodeMessage(d);
      } catch (error: unknown) {
        if (error instanceof DecodeError) {
          options.onUnknownDispatch({ t, d });
          return;
        }
        throw error;
      }
      return;
    }
    options.onUnknownDispatch({ t, d });
  };

  const onText = (text: string): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      beginProtocolFailure();
      return;
    }
    if (!isRecord(parsed) || !("op" in parsed) || typeof parsed.op !== "number") {
      beginProtocolFailure();
      return;
    }
    rememberSequence(parsed);
    if (parsed.op === OP_HELLO) {
      onHello("d" in parsed ? parsed.d : undefined);
      return;
    }
    if (parsed.op === OP_HEARTBEAT_ACK) {
      awaitingAck = false;
      return;
    }
    if (parsed.op === OP_HEARTBEAT) {
      sendHeartbeat(true);
      return;
    }
    if (parsed.op === OP_RECONNECT) {
      beginResumeOrIdentifyNow(CLOSE_PROTOCOL);
      return;
    }
    if (parsed.op === OP_INVALID_SESSION) {
      const resumable = "d" in parsed && parsed.d === true;
      if (resumable) {
        beginResumeOrIdentifyNow(CLOSE_PROTOCOL);
        return;
      }
      beginIdentifyBackoff(CLOSE_PROTOCOL);
      return;
    }
    if (parsed.op === OP_DISPATCH) {
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
  };

  const beginResumeOrIdentifyNow = (closeCode: number | undefined): void => {
    if (stopped || reconnecting) {
      return;
    }
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

  const stop = (code: number): void => {
    stopped = true;
    clearHeartbeat();
    clearBackoff();
    const current = connection;
    connection = undefined;
    if (current !== undefined) {
      current.close(code);
    }
  };

  await openGateway(options.url, false);
  return { stop };
}
