import assert from "node:assert/strict";
import { GatewayIntent } from "../src/index.js";
import { createTestClient } from "../src/testing.js";
import type { Clock, GatewayConnect, GatewayConnectionHandlers, RestHttp } from "../src/testing.js";

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

const http: RestHttp = {
  request: async () => ({
    status: 200,
    headers: {},
    body: JSON.stringify({
      url: "wss://gateway.discord.gg/",
      shards: 1,
      session_start_limit: {
        total: 1000,
        remaining: 999,
        reset_after: 14400000,
        max_concurrency: 1,
      },
    }),
  }),
};

let handlers: GatewayConnectionHandlers | undefined;
let notifyOpen = () => {};
const opened = new Promise<void>((resolve) => {
  notifyOpen = resolve;
});
const gateway: GatewayConnect = async (_url, next) => {
  handlers = next;
  notifyOpen();
  return {
    sendText: () => {},
    close: () => {},
  };
};

const clock = createManualClock();
const client = createTestClient(
  { token: "bot-token", intents: GatewayIntent.Guilds },
  { http, clock, gateway },
);

void client.closed.then(
  () => {},
  () => {},
);

let seen = 0;
client.on("MESSAGE_CREATE", (payload) => {
  assert.ok(typeof payload === "object" && payload !== null);
  seen += 1;
});

const connected = client.connect();
await opened;
assert.ok(handlers !== undefined);
handlers.onText(JSON.stringify({ op: 10, d: { heartbeat_interval: 1000 } }));
clock.advance(1000);
handlers.onText(JSON.stringify({ op: 11, d: null }));
handlers.onText(
  JSON.stringify({
    op: 0,
    s: 1,
    t: "READY",
    d: {
      session_id: "session-1",
      resume_gateway_url: "wss://resume.discord.gg",
      user: { id: "1", username: "bot", discriminator: "0", avatar: null },
      guilds: [],
    },
  }),
);
await connected;
handlers.onText(
  JSON.stringify({
    op: 0,
    s: 2,
    t: "MESSAGE_CREATE",
    d: {
      id: "10",
      channel_id: "20",
      content: "ping",
      timestamp: "2017-07-11T17:27:07.299000+00:00",
      edited_timestamp: null,
      tts: false,
      mention_everyone: false,
      mentions: [],
      mention_roles: [],
      attachments: [],
      embeds: [],
      pinned: false,
      type: 0,
      author: {
        id: "1",
        username: "bot",
        discriminator: "0",
        avatar: null,
      },
    },
  }),
);
assert.equal(seen, 1);
console.log("MESSAGE_CREATE smoke ok");
