import { readFileSync } from "node:fs";
import type { Clock, GatewayConnect } from "../../src/ports.js";
import { startSession } from "../../src/session.js";
import { reportSamples } from "../lib/measure.js";

const helloText = readFileSync("fixtures/heartbeat/hello.json", "utf8");
const ackText = readFileSync("fixtures/heartbeat/heartbeat-ack.json", "utf8");
const readyText = readFileSync("fixtures/heartbeat/ready-dispatch.json", "utf8");

function heartbeatIntervalMs(text: string): number {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || !("d" in parsed)) {
    throw new Error("hello fixture must include d");
  }
  const data = parsed.d;
  if (typeof data !== "object" || data === null || Array.isArray(data) || !("heartbeat_interval" in data)) {
    throw new Error("hello fixture must include heartbeat_interval");
  }
  const interval = data.heartbeat_interval;
  if (typeof interval !== "number") {
    throw new Error("heartbeat_interval must be a number");
  }
  return interval;
}

const HEARTBEAT_INTERVAL_MS = heartbeatIntervalMs(helloText);
const BATCH = 1024;
const WARMUP = 20;
const ITERATIONS = 80;

type Timer = { at: number; callback: () => void; cancelled: boolean };

function createManualClock(): Clock & { advance: (ms: number) => void } {
  let nowMs = 0;
  let timers: Timer[] = [];
  return {
    nowMs: () => nowMs,
    schedule: (delayMs, callback) => {
      const timer: Timer = { at: nowMs + delayMs, callback, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    advance: (ms) => {
      nowMs += ms;
      let fired = true;
      while (fired) {
        fired = false;
        for (let i = 0; i < timers.length; i += 1) {
          const timer = timers[i];
          if (timer !== undefined && !timer.cancelled && timer.at <= nowMs) {
            timer.cancelled = true;
            fired = true;
            timer.callback();
          }
        }
      }
      const live: Timer[] = [];
      for (let i = 0; i < timers.length; i += 1) {
        const timer = timers[i];
        if (timer !== undefined && !timer.cancelled) {
          live.push(timer);
        }
      }
      timers = live;
    },
  };
}

function nowMs(): number {
  return performance.now();
}

const clock = createManualClock();
const sent: string[] = [];
let onText: ((text: string) => void) | undefined;
let capturing = false;
let markStart = 0;
let markedMs = 0;
const connect: GatewayConnect = async (_url, handlers) => {
  onText = handlers.onText;
  return {
    sendText: (text) => {
      sent.push(text);
      if (capturing) {
        markedMs = nowMs() - markStart;
        capturing = false;
      }
    },
    close: (_code) => {},
  };
};

await startSession({
  url: "wss://gateway.discord.gg/",
  token: "bot-token",
  intents: 1,
  clock,
  connect,
  onFatal: () => {},
  onUnknownDispatch: () => {},
  onDispatch: () => {},
  onReadyLost: () => {},
});

if (onText === undefined) {
  throw new Error("Session did not attach Gateway onText");
}
const inbound = onText;
inbound(helloText);
clock.advance(HEARTBEAT_INTERVAL_MS);
inbound(ackText);
inbound(readyText);

function emitDueHeartbeat(): void {
  inbound(ackText);
  clock.advance(HEARTBEAT_INTERVAL_MS);
}

for (let i = 0; i < WARMUP; i += 1) {
  for (let j = 0; j < BATCH; j += 1) {
    emitDueHeartbeat();
  }
}

const last = sent[sent.length - 1];
if (last === undefined) {
  throw new Error("warmup did not emit a Heartbeat");
}
const parsed: unknown = JSON.parse(last);
if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || !("op" in parsed)) {
  throw new Error("Heartbeat JSON must include op");
}
if (parsed.op !== 1) {
  throw new Error("Clock deadline must hand Heartbeat op 1 to sendText");
}

const samples: number[] = [];
for (let i = 0; i < ITERATIONS; i += 1) {
  let elapsedMs = 0;
  for (let j = 0; j < BATCH; j += 1) {
    inbound(ackText);
    capturing = true;
    markStart = nowMs();
    clock.advance(HEARTBEAT_INTERVAL_MS);
    if (capturing) {
      throw new Error("Clock deadline did not hand Heartbeat JSON to sendText");
    }
    elapsedMs += markedMs;
  }
  samples.push((elapsedMs / BATCH) * 1000);
}
reportSamples(samples);
