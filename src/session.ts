import type { Clock, GatewayConnect, GatewayConnection } from "./ports.js";

export type SessionOptions = {
  url: string;
  token: string;
  intents: number;
  clock: Clock;
  connect: GatewayConnect;
  shard?: [number, number];
};

export type SessionHandle = {
  stop: (code: number) => void;
};

const OP_HEARTBEAT = 1;
const OP_IDENTIFY = 2;
const OP_HELLO = 10;
const OP_HEARTBEAT_ACK = 11;

function identifyOs(): string {
  if (typeof process.platform === "string" && process.platform.length > 0) {
    return process.platform;
  }
  return "linux";
}

export async function startSession(options: SessionOptions): Promise<SessionHandle> {
  let connection: GatewayConnection | undefined;
  let cancelHeartbeat: (() => void) | undefined;
  let sequence: number | null = null;
  let heartbeatIntervalMs = 0;
  let identified = false;
  let awaitingAck = false;

  const clearHeartbeat = (): void => {
    if (cancelHeartbeat !== undefined) {
      cancelHeartbeat();
      cancelHeartbeat = undefined;
    }
  };

  const sendIdentify = (): void => {
    if (connection === undefined || identified) {
      return;
    }
    identified = true;
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

  const sendHeartbeat = (immediate: boolean): void => {
    if (connection === undefined) {
      return;
    }
    if (awaitingAck && !immediate) {
      return;
    }
    connection.sendText(JSON.stringify({ op: OP_HEARTBEAT, d: sequence }));
    awaitingAck = true;
  };

  const scheduleNextHeartbeat = (delayMs: number): void => {
    clearHeartbeat();
    cancelHeartbeat = options.clock.schedule(delayMs, () => {
      sendHeartbeat(false);
      sendIdentify();
      if (heartbeatIntervalMs > 0) {
        scheduleNextHeartbeat(heartbeatIntervalMs);
      }
    });
  };

  const onHello = (data: unknown): void => {
    if (typeof data !== "object" || data === null || Array.isArray(data) || !("heartbeat_interval" in data)) {
      return;
    }
    const interval = data.heartbeat_interval;
    if (typeof interval !== "number") {
      return;
    }
    heartbeatIntervalMs = interval;
    scheduleNextHeartbeat(interval * Math.random());
  };

  const onText = (text: string): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || !("op" in parsed)) {
      return;
    }
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
    }
  };

  const stop = (code: number): void => {
    clearHeartbeat();
    if (connection !== undefined) {
      connection.close(code);
    }
  };

  connection = await options.connect(options.url, {
    onText,
    onClose: () => {
      clearHeartbeat();
    },
    onError: () => {},
  });
  return { stop };
}
