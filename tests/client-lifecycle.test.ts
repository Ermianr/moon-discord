import assert from "node:assert/strict";
import { test } from "node:test";
import { CancelledError, ConfigurationError, DiscordHttpError, GatewayFatalError, GatewayIntent } from "moon-discord";
import { createTestClient } from "moon-discord/testing";
import type { Clock, GatewayConnect, GatewayConnectionHandlers, RestHttp } from "moon-discord/testing";

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

function gatewayBotBody(url: string): string {
  return JSON.stringify({
    url,
    shards: 1,
    session_start_limit: {
      total: 1000,
      remaining: 999,
      reset_after: 14400000,
      max_concurrency: 1,
    },
  });
}

function countingGatewayBotHttp(urls: string[]): RestHttp {
  let index = 0;
  return {
    request: async () => {
      const url = urls[index];
      if (url === undefined) {
        throw new Error("unexpected Get Gateway Bot");
      }
      index += 1;
      return {
        status: 200,
        headers: {},
        body: gatewayBotBody(url),
      };
    },
  };
}

type MemoryGateway = {
  connect: GatewayConnect;
  urls: string[];
  closeCodes: number[];
  inbound: (text: string) => void;
  remoteClose: (code: number | undefined) => void;
  waitOpens: (count: number) => Promise<void>;
};

function createMemoryGateway(): MemoryGateway {
  const urls: string[] = [];
  const closeCodes: number[] = [];
  const handlers: GatewayConnectionHandlers[] = [];
  let notifyOpens = () => {};
  const connect: GatewayConnect = async (url, next) => {
    urls.push(url);
    handlers.push(next);
    notifyOpens();
    return {
      sendText: () => {},
      close: (code) => {
        closeCodes.push(code);
        next.onClose(code);
      },
    };
  };
  return {
    connect,
    urls,
    closeCodes,
    inbound: (text) => {
      const current = handlers[handlers.length - 1];
      if (current !== undefined) {
        current.onText(text);
      }
    },
    remoteClose: (code) => {
      const current = handlers[handlers.length - 1];
      if (current !== undefined) {
        current.onClose(code);
      }
    },
    waitOpens: (count) => {
      return new Promise((resolve) => {
        const check = () => {
          if (urls.length >= count) {
            resolve();
            return;
          }
          notifyOpens = check;
        };
        check();
      });
    },
  };
}

async function waitBound(gateway: MemoryGateway, count: number): Promise<void> {
  await gateway.waitOpens(count);
  await Promise.resolve();
  await Promise.resolve();
}

function hello(heartbeatInterval: number): string {
  return JSON.stringify({ op: 10, d: { heartbeat_interval: heartbeatInterval } });
}

function readyDispatch(): string {
  return JSON.stringify({
    op: 0,
    s: 1,
    t: "READY",
    d: {
      session_id: "session-1",
      resume_gateway_url: "wss://resume.discord.gg",
      user: {
        id: "1",
        username: "bot",
        discriminator: "0",
        avatar: null,
      },
      guilds: [],
    },
  });
}

async function openConnectingClient(gatewayUrl: string = "wss://gateway.discord.gg/") {
  const clock = createManualClock();
  const gateway = createMemoryGateway();
  const client = createTestClient(
    { token: "bot-token", intents: GatewayIntent.Guilds },
    { http: countingGatewayBotHttp([gatewayUrl]), clock, gateway: gateway.connect },
  );
  void client.closed.then(
    () => {},
    () => {},
  );
  const connectPromise = client.connect();
  connectPromise.then(
    () => {},
    () => {},
  );
  await waitBound(gateway, 1);
  return { client, clock, gateway, connectPromise };
}

async function handshakeReady(clock: ManualClock, gateway: MemoryGateway): Promise<void> {
  gateway.inbound(hello(1000));
  clock.advance(1000);
  gateway.inbound(JSON.stringify({ op: 11, d: null }));
  gateway.inbound(readyDispatch());
}

test("connect resolves on decoded READY and not on GUILD_CREATE", async () => {
  const { client, clock, gateway, connectPromise } = await openConnectingClient();
  let resolved = false;
  void connectPromise.then(() => {
    resolved = true;
  });
  gateway.inbound(hello(1000));
  clock.advance(1000);
  gateway.inbound(JSON.stringify({ op: 11, d: null }));
  gateway.inbound(
    JSON.stringify({
      op: 0,
      s: 1,
      t: "GUILD_CREATE",
      d: { id: "1" },
    }),
  );
  await Promise.resolve();
  assert.equal(resolved, false);
  gateway.inbound(readyDispatch());
  await Promise.race([
    connectPromise,
    new Promise<void>((_, reject) => {
      setTimeout(() => {
        reject(new Error("connect did not resolve on READY"));
      }, 50);
    }),
  ]);
  assert.equal(resolved, true);
});

function messageCreateDispatch(): string {
  return JSON.stringify({
    op: 0,
    s: 2,
    t: "MESSAGE_CREATE",
    d: {
      id: "10",
      channel_id: "20",
      guild_id: "30",
      content: "hi",
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
  });
}

function inboundMessageJson(): string {
  return JSON.stringify({
    id: "10",
    channel_id: "20",
    content: "pong",
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
  });
}

test("connect resolves on decoded RESUMED after inner reconnect", async () => {
  const { clock, gateway, connectPromise } = await openConnectingClient();
  await handshakeReady(clock, gateway);
  await connectPromise;
  gateway.remoteClose(4002);
  await waitBound(gateway, 2);
  gateway.inbound(hello(1000));
  clock.advance(1000);
  gateway.inbound(JSON.stringify({ op: 11, d: null }));
  gateway.inbound(JSON.stringify({ op: 0, s: 2, t: "RESUMED", d: {} }));
  await connectPromise;
});

test("second connect while live throws ConfigurationError", async () => {
  const { client, clock, gateway, connectPromise } = await openConnectingClient();
  await assert.rejects(() => client.connect(), (error: unknown) => {
    assert.ok(error instanceof ConfigurationError);
    return true;
  });
  await handshakeReady(clock, gateway);
  await connectPromise;
  await assert.rejects(() => client.connect(), (error: unknown) => {
    assert.ok(error instanceof ConfigurationError);
    return true;
  });
});

test("connect after disconnect is allowed and refreshes Get Gateway Bot", async () => {
  const clock = createManualClock();
  const gateway = createMemoryGateway();
  const client = createTestClient(
    { token: "bot-token", intents: GatewayIntent.Guilds },
    {
      http: countingGatewayBotHttp(["wss://gateway.discord.gg/first", "wss://gateway.discord.gg/second"]),
      clock,
      gateway: gateway.connect,
    },
  );
  void client.closed.then(
    () => {},
    () => {},
  );
  const first = client.connect();
  first.then(
    () => {},
    () => {},
  );
  await waitBound(gateway, 1);
  await handshakeReady(clock, gateway);
  await first;
  assert.equal(gateway.urls[0], "wss://gateway.discord.gg/first");
  await client.disconnect();
  const second = client.connect();
  await waitBound(gateway, 2);
  assert.equal(gateway.urls[1], "wss://gateway.discord.gg/second");
  gateway.inbound(hello(1000));
  clock.advance(1000);
  gateway.inbound(JSON.stringify({ op: 11, d: null }));
  gateway.inbound(readyDispatch());
  await second;
});

test("AbortSignal rejects connect as CancelledError", async () => {
  const already = createTestClient(
    { token: "bot-token", intents: GatewayIntent.Guilds },
    {
      http: countingGatewayBotHttp(["wss://gateway.discord.gg/"]),
      clock: createManualClock(),
      gateway: async () => {
        return {
          sendText: () => {},
          close: () => {},
        };
      },
    },
  );
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(() => already.connect({ signal: aborted.signal }), (error: unknown) => {
    assert.ok(error instanceof CancelledError);
    return true;
  });

  const clock = createManualClock();
  const gateway = createMemoryGateway();
  const controller = new AbortController();
  const client = createTestClient(
    { token: "bot-token", intents: GatewayIntent.Guilds },
    { http: countingGatewayBotHttp(["wss://gateway.discord.gg/"]), clock, gateway: gateway.connect },
  );
  void client.closed.then(
    () => {},
    () => {},
  );
  const live = client.connect({ signal: controller.signal });
  live.then(
    () => {},
    () => {},
  );
  await waitBound(gateway, 1);
  controller.abort();
  await assert.rejects(live, (error: unknown) => {
    assert.ok(error instanceof CancelledError);
    return true;
  });
});

test("on uses Discord t strings and does not replay missed events", async () => {
  const { client, clock, gateway, connectPromise } = await openConnectingClient();
  const seen: unknown[] = [];
  client.on("MESSAGE_CREATE", (payload) => {
    seen.push(payload);
  });
  await handshakeReady(clock, gateway);
  await connectPromise;
  gateway.inbound(messageCreateDispatch());
  assert.equal(seen.length, 1);
  const first = seen[0];
  assert.ok(typeof first === "object" && first !== null && !Array.isArray(first));
  assert.equal(Object.prototype.hasOwnProperty.call(first, "shardId"), false);
  const late: unknown[] = [];
  client.on("MESSAGE_CREATE", (payload) => {
    late.push(payload);
  });
  assert.deepEqual(late, []);
  gateway.inbound(
    JSON.stringify({
      op: 0,
      s: 3,
      t: "MESSAGE_CREATE",
      d: {
        id: "11",
        channel_id: "20",
        content: "later",
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
  assert.equal(seen.length, 2);
  assert.equal(late.length, 1);
});

test("unknown dispatch goes only to onUnknownDispatch", async () => {
  const { client, clock, gateway, connectPromise } = await openConnectingClient();
  const typed: unknown[] = [];
  const unknown: unknown[] = [];
  client.on("MESSAGE_CREATE", (payload) => {
    typed.push(payload);
  });
  client.onUnknownDispatch((payload) => {
    unknown.push(payload);
  });
  await handshakeReady(clock, gateway);
  await connectPromise;
  gateway.inbound(
    JSON.stringify({
      op: 0,
      s: 2,
      t: "MESSAGE_CREATE",
      d: { not: "a message" },
    }),
  );
  gateway.inbound(
    JSON.stringify({
      op: 0,
      s: 3,
      t: "NEW_EVENT",
      d: { x: 1 },
    }),
  );
  assert.deepEqual(typed, []);
  assert.deepEqual(unknown, [
    { t: "MESSAGE_CREATE", d: { not: "a message" } },
    { t: "NEW_EVENT", d: { x: 1 } },
  ]);
});

test("handler throws do not tear down the Session", async () => {
  const { client, clock, gateway, connectPromise } = await openConnectingClient();
  client.on("MESSAGE_CREATE", () => {
    throw new Error("handler boom");
  });
  await handshakeReady(clock, gateway);
  await connectPromise;
  gateway.inbound(messageCreateDispatch());
  let closedSettled = false;
  void client.closed.then(
    () => {
      closedSettled = true;
    },
    () => {
      closedSettled = true;
    },
  );
  await Promise.resolve();
  assert.equal(closedSettled, false);
  assert.equal(gateway.closeCodes.length, 0);
});

test("closed is pending at construct; disconnect fulfills and is idempotent", async () => {
  const client = createTestClient(
    { token: "bot-token" },
    {
      http: {
        request: async () => ({ status: 200, headers: {}, body: "{}" }),
      },
      clock: {
        nowMs: () => 0,
        schedule: () => () => {},
      },
    },
  );
  let outcome: string | undefined;
  void client.closed.then(
    () => {
      outcome = "fulfilled";
    },
    () => {
      outcome = "rejected";
    },
  );
  await Promise.resolve();
  assert.equal(outcome, undefined);
  await client.disconnect();
  await client.closed;
  assert.equal(outcome, "fulfilled");
  await client.disconnect();
  await client.closed;
});

test("disconnect rejects pending connect with CancelledError", async () => {
  const { client, connectPromise } = await openConnectingClient();
  await client.disconnect();
  await assert.rejects(connectPromise, (error: unknown) => {
    assert.ok(error instanceof CancelledError);
    return true;
  });
  await client.closed;
});

test("first fatal wins", async () => {
  const { client, clock, gateway, connectPromise } = await openConnectingClient();
  await handshakeReady(clock, gateway);
  await connectPromise;
  gateway.remoteClose(4004);
  await assert.rejects(client.closed, (error: unknown) => {
    assert.ok(error instanceof GatewayFatalError);
    assert.equal(error.closeCode, 4004);
    return true;
  });
  gateway.remoteClose(4013);
  await assert.rejects(client.closed, (error: unknown) => {
    assert.ok(error instanceof GatewayFatalError);
    assert.equal(error.closeCode, 4004);
    return true;
  });
});

test("REST remains legal after disconnect", async () => {
  const clock = createManualClock();
  const gateway = createMemoryGateway();
  const client = createTestClient(
    { token: "bot-token", intents: GatewayIntent.Guilds },
    {
      http: {
        request: async (request) => {
          if (request.url.endsWith("/gateway/bot")) {
            return {
              status: 200,
              headers: {},
              body: gatewayBotBody("wss://gateway.discord.gg/"),
            };
          }
          return { status: 200, headers: {}, body: inboundMessageJson() };
        },
      },
      clock,
      gateway: gateway.connect,
    },
  );
  void client.closed.then(
    () => {},
    () => {},
  );
  const connectPromise = client.connect();
  await waitBound(gateway, 1);
  await handshakeReady(clock, gateway);
  await connectPromise;
  await client.disconnect();
  const message = await client.rest.createMessage("20", { content: "pong" });
  assert.equal(message.content, "pong");
});

test("REST remains legal after non-token Gateway fatal", async () => {
  const clock = createManualClock();
  const gateway = createMemoryGateway();
  let httpCalls = 0;
  const client = createTestClient(
    { token: "bot-token", intents: GatewayIntent.Guilds },
    {
      http: {
        request: async (request) => {
          httpCalls += 1;
          if (request.url.endsWith("/gateway/bot")) {
            return {
              status: 200,
              headers: {},
              body: gatewayBotBody("wss://gateway.discord.gg/"),
            };
          }
          return { status: 200, headers: {}, body: inboundMessageJson() };
        },
      },
      clock,
      gateway: gateway.connect,
    },
  );
  void client.closed.then(
    () => {},
    () => {},
  );
  const connectPromise = client.connect();
  await waitBound(gateway, 1);
  await handshakeReady(clock, gateway);
  await connectPromise;
  gateway.remoteClose(4013);
  await assert.rejects(client.closed, (error: unknown) => {
    assert.ok(error instanceof GatewayFatalError);
    assert.equal(error.closeCode, 4013);
    return true;
  });
  const before = httpCalls;
  const message = await client.rest.createMessage("20", { content: "pong" });
  assert.equal(message.content, "pong");
  assert.equal(httpCalls, before + 1);
});

test("token 4004 stops Sessions and further Rest is DiscordHttpError without retry", async () => {
  const clock = createManualClock();
  const gateway = createMemoryGateway();
  let httpCalls = 0;
  const client = createTestClient(
    { token: "bot-token", intents: GatewayIntent.Guilds },
    {
      http: {
        request: async (request) => {
          httpCalls += 1;
          if (request.url.endsWith("/gateway/bot")) {
            return {
              status: 200,
              headers: {},
              body: gatewayBotBody("wss://gateway.discord.gg/"),
            };
          }
          return { status: 200, headers: {}, body: inboundMessageJson() };
        },
      },
      clock,
      gateway: gateway.connect,
    },
  );
  void client.closed.then(
    () => {},
    () => {},
  );
  const connectPromise = client.connect();
  await waitBound(gateway, 1);
  await handshakeReady(clock, gateway);
  await connectPromise;
  const afterConnect = httpCalls;
  gateway.remoteClose(4004);
  await assert.rejects(client.closed, (error: unknown) => {
    assert.ok(error instanceof GatewayFatalError);
    return true;
  });
  await assert.rejects(() => client.rest.createMessage("20", { content: "pong" }), (error: unknown) => {
    assert.ok(error instanceof DiscordHttpError);
    assert.equal(error.status, 401);
    return true;
  });
  assert.equal(httpCalls, afterConnect);
  assert.equal(gateway.urls.length, 1);
});

test("token HTTP 401 while live stops Sessions and further Rest without retry", async () => {
  const clock = createManualClock();
  const gateway = createMemoryGateway();
  let httpCalls = 0;
  const client = createTestClient(
    { token: "bot-token", intents: GatewayIntent.Guilds },
    {
      http: {
        request: async (request) => {
          httpCalls += 1;
          if (request.url.endsWith("/gateway/bot")) {
            return {
              status: 200,
              headers: {},
              body: gatewayBotBody("wss://gateway.discord.gg/"),
            };
          }
          return {
            status: 401,
            headers: {},
            body: JSON.stringify({ message: "401: Unauthorized", code: 0 }),
          };
        },
      },
      clock,
      gateway: gateway.connect,
    },
  );
  void client.closed.then(
    () => {},
    () => {},
  );
  const connectPromise = client.connect();
  await waitBound(gateway, 1);
  await handshakeReady(clock, gateway);
  await connectPromise;
  await assert.rejects(() => client.rest.createMessage("20", { content: "pong" }), (error: unknown) => {
    assert.ok(error instanceof DiscordHttpError);
    assert.equal(error.status, 401);
    return true;
  });
  await assert.rejects(client.closed, (error: unknown) => {
    assert.ok(error instanceof DiscordHttpError);
    assert.equal(error.status, 401);
    return true;
  });
  const afterDeath = httpCalls;
  await assert.rejects(() => client.rest.createMessage("20", { content: "pong" }), (error: unknown) => {
    assert.ok(error instanceof DiscordHttpError);
    assert.equal(error.status, 401);
    return true;
  });
  assert.equal(httpCalls, afterDeath);
});

