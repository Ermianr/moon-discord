import assert from "node:assert/strict";
import { test } from "node:test";
import { GatewayIntent, type ClientOptions } from "moon-discord";
import { createTestClient } from "moon-discord/testing";
import type { Clock, GatewayConnect, RestHttp } from "moon-discord/testing";

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

function gatewayBotHttp(): RestHttp {
  return {
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
}

function createMemoryGateway(): {
  connect: GatewayConnect;
  opened: Promise<string>;
  sent: string[];
  inbound: (text: string) => void;
} {
  const sent: string[] = [];
  let onText: ((text: string) => void) | undefined;
  let resolveOpened: (url: string) => void = () => {};
  const opened = new Promise<string>((resolve) => {
    resolveOpened = resolve;
  });
  const connect: GatewayConnect = async (url, handlers) => {
    onText = handlers.onText;
    resolveOpened(url);
    return {
      sendText: (text) => {
        sent.push(text);
      },
      close: () => {},
    };
  };
  return {
    connect,
    opened,
    sent,
    inbound: (text) => {
      if (onText !== undefined) {
        onText(text);
      }
    },
  };
}

async function connectingClient(options?: { intents?: number; shards?: ClientOptions["shards"] }) {
  const clock = createManualClock();
  const gateway = createMemoryGateway();
  const clientOptions: ClientOptions = {
    token: "bot-token",
    intents: options?.intents ?? GatewayIntent.Guilds,
  };
  if (options?.shards !== undefined) {
    clientOptions.shards = options.shards;
  }
  const client = createTestClient(clientOptions, {
    http: gatewayBotHttp(),
    clock,
    gateway: gateway.connect,
  });
  void client.connect();
  await gateway.opened;
  return { client, clock, gateway };
}

function hello(heartbeatInterval: number): string {
  return JSON.stringify({ op: 10, d: { heartbeat_interval: heartbeatInterval } });
}

function parseSent(gateway: { sent: string[] }): unknown[] {
  return gateway.sent.map((text) => JSON.parse(text) as unknown);
}

test("connect opens the Get Gateway Bot url on the text Gateway connection", async () => {
  const gateway = createMemoryGateway();
  const client = createTestClient(
    { token: "bot-token", intents: GatewayIntent.Guilds },
    {
      http: gatewayBotHttp(),
      clock: createManualClock(),
      gateway: gateway.connect,
    },
  );
  void client.connect();
  const url = await gateway.opened;
  assert.equal(url, "wss://gateway.discord.gg/");
});

test("Hello then first Heartbeat after at most heartbeat_interval, with d null", async () => {
  const { clock, gateway } = await connectingClient();
  gateway.inbound(hello(1000));
  assert.equal(gateway.sent.length, 0);
  clock.advance(1000);
  const payloads = parseSent(gateway);
  assert.deepEqual(payloads[0], { op: 1, d: null });
});

test("Identify follows the first Heartbeat with token, intents, and properties", async () => {
  const { clock, gateway } = await connectingClient();
  gateway.inbound(hello(1000));
  clock.advance(1000);
  const payloads = parseSent(gateway);
  assert.equal(payloads.length, 2);
  assert.deepEqual(payloads[1], {
    op: 2,
    d: {
      token: "bot-token",
      intents: GatewayIntent.Guilds,
      properties: {
        os: process.platform,
        browser: "moon-discord",
        device: "moon-discord",
      },
    },
  });
  const identify = payloads[1] as { d: Record<string, unknown> };
  assert.equal("compress" in identify.d, false);
  assert.equal("large_threshold" in identify.d, false);
  assert.equal("capabilities" in identify.d, false);
  assert.equal("shard" in identify.d, false);
});

test("explicit intents 0 is sent on Identify", async () => {
  const { clock, gateway } = await connectingClient({ intents: 0 });
  gateway.inbound(hello(1000));
  clock.advance(1000);
  const payloads = parseSent(gateway);
  const identify = payloads[1] as { d: { intents: number } };
  assert.equal(identify.d.intents, 0);
});

test("Identify includes shard when Client shards is { id, count }", async () => {
  const { clock, gateway } = await connectingClient({ shards: { id: 2, count: 5 } });
  gateway.inbound(hello(1000));
  clock.advance(1000);
  const payloads = parseSent(gateway);
  const identify = payloads[1] as { d: { shard: [number, number] } };
  assert.deepEqual(identify.d.shard, [2, 5]);
});

test("Heartbeat ACK is required before the next interval Heartbeat", async () => {
  const { clock, gateway } = await connectingClient();
  gateway.inbound(hello(1000));
  clock.advance(1000);
  assert.equal(gateway.sent.length, 2);
  clock.advance(1000);
  assert.equal(gateway.sent.length, 2);
});

test("after Heartbeat ACK, the next interval Heartbeat is sent", async () => {
  const { clock, gateway } = await connectingClient();
  gateway.inbound(hello(1000));
  clock.advance(1000);
  gateway.inbound(JSON.stringify({ op: 11, d: null }));
  clock.advance(1000);
  const payloads = parseSent(gateway);
  assert.deepEqual(payloads[2], { op: 1, d: null });
});

test("Discord-initiated Heartbeat is answered immediately", async () => {
  const { gateway } = await connectingClient();
  gateway.inbound(hello(1000));
  gateway.inbound(JSON.stringify({ op: 1, d: null }));
  const payloads = parseSent(gateway);
  assert.deepEqual(payloads[0], { op: 1, d: null });
  assert.equal(payloads.length, 1);
});
