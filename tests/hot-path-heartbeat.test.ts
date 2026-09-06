import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Clock, GatewayConnect } from "../src/ports.js";
import { startSession } from "../src/session.js";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function readFixture(name: string): string {
  return fs.readFileSync(path.join(repoRoot, "fixtures/heartbeat", name), "utf8").trim();
}

type ManualClock = Clock & { advance: (ms: number) => void };

function createManualClock(): ManualClock {
  let nowMs = 0;
  type Timer = { at: number; callback: () => void; cancelled: boolean };
  const timers: Timer[] = [];
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
    },
  };
}

test("live Session hands Heartbeat op 1 JSON to sendText when the Clock deadline fires", async () => {
  const hello = readFixture("hello.json");
  const ack = readFixture("heartbeat-ack.json");
  const ready = readFixture("ready-dispatch.json");
  const clock = createManualClock();
  const sent: string[] = [];
  let onText: ((text: string) => void) | undefined;
  const connect: GatewayConnect = async (_url, handlers) => {
    onText = handlers.onText;
    return {
      sendText: (text) => {
        sent.push(text);
      },
      close: () => {},
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
  assert.ok(onText !== undefined);
  if (onText === undefined) {
    return;
  }
  onText(hello);
  clock.advance(41250);
  onText(ack);
  onText(ready);
  const beforePeriodic = sent.length;
  clock.advance(41250);
  assert.equal(sent.length, beforePeriodic + 1);
  const heartbeat = JSON.parse(sent[sent.length - 1] ?? "") as unknown;
  assert.deepEqual(heartbeat, { op: 1, d: 42 });
});
