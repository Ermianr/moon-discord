import assert from "node:assert/strict";
import { test } from "node:test";
import { GatewayIntent, type Message } from "moon-discord";
import { createTestClient } from "moon-discord/testing";
import type { Clock, GatewayConnect, GatewayConnectionHandlers, RestHttp, RestHttpRequest } from "moon-discord/testing";

type ManualClock = Clock & { advance: (ms: number) => void };

const PING_INTENTS = GatewayIntent.Guilds | GatewayIntent.GuildMessages | GatewayIntent.MessageContent;

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

function gatewayBotBody(): string {
  return JSON.stringify({
    url: "wss://gateway.discord.gg/",
    shards: 1,
    session_start_limit: {
      total: 1000,
      remaining: 999,
      reset_after: 14400000,
      max_concurrency: 1,
    },
  });
}

function inboundMessageJson(): string {
  return JSON.stringify({
    id: "334385199974967042",
    channel_id: "290926798999357250",
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

function typicalMessageCreateDispatch(): string {
  return JSON.stringify({
    op: 0,
    s: 2,
    t: "MESSAGE_CREATE",
    d: {
      id: "10",
      channel_id: "20",
      guild_id: "30",
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
      flags: 0,
      nonce: "1234",
      referenced_message: null,
      author: {
        id: "1",
        username: "bot",
        discriminator: "0",
        avatar: null,
        extra: "drop-me",
      },
    },
  });
}

type MemoryGateway = {
  connect: GatewayConnect;
  closeCodes: number[];
  sent: string[];
  inbound: (text: string) => void;
  waitOpen: () => Promise<void>;
};

function createMemoryGateway(): MemoryGateway {
  const closeCodes: number[] = [];
  const sent: string[] = [];
  let handlers: GatewayConnectionHandlers | undefined;
  let notifyOpen = () => {};
  const opened = new Promise<void>((resolve) => {
    notifyOpen = resolve;
  });
  const connect: GatewayConnect = async (_url, next) => {
    handlers = next;
    notifyOpen();
    return {
      sendText: (text) => {
        sent.push(text);
      },
      close: (code) => {
        closeCodes.push(code);
        next.onClose(code);
      },
    };
  };
  return {
    connect,
    closeCodes,
    sent,
    inbound: (text) => {
      if (handlers !== undefined) {
        handlers.onText(text);
      }
    },
    waitOpen: () => opened,
  };
}

async function handshakeReady(clock: ManualClock, gateway: MemoryGateway): Promise<void> {
  gateway.inbound(JSON.stringify({ op: 10, d: { heartbeat_interval: 1000 } }));
  clock.advance(1000);
  gateway.inbound(JSON.stringify({ op: 11, d: null }));
  gateway.inbound(
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
}

async function openPingClient(http: RestHttp) {
  const clock = createManualClock();
  const gateway = createMemoryGateway();
  const client = createTestClient(
    { token: "bot-token", intents: PING_INTENTS },
    { http, clock, gateway: gateway.connect },
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
  await gateway.waitOpen();
  await Promise.resolve();
  await Promise.resolve();
  await handshakeReady(clock, gateway);
  await connectPromise;
  return { client, clock, gateway };
}

test("MESSAGE_CREATE inbound model is a closed struct and drops extra keys", async () => {
  const { client, gateway } = await openPingClient({
    request: async () => ({ status: 200, headers: {}, body: gatewayBotBody() }),
  });
  const seen: Message[] = [];
  client.on("MESSAGE_CREATE", (message) => {
    seen.push(message);
  });
  gateway.inbound(typicalMessageCreateDispatch());
  assert.equal(seen.length, 1);
  const message = seen[0];
  assert.ok(message !== undefined);
  assert.equal(message.id, "10");
  assert.equal(message.channel_id, "20");
  assert.equal(message.content, "ping");
  assert.equal("guild_id" in message, false);
  assert.equal("flags" in message, false);
  assert.equal("nonce" in message, false);
  assert.equal("referenced_message" in message, false);
  assert.equal("extra" in message.author, false);
});

test("createTestClient ping bot replies to MESSAGE_CREATE with typed createMessage JSON", async () => {
  const restCalls: RestHttpRequest[] = [];
  const { client, gateway } = await openPingClient({
    request: async (request) => {
      if (request.method === "GET" && request.url.endsWith("/gateway/bot")) {
        return { status: 200, headers: {}, body: gatewayBotBody() };
      }
      restCalls.push(request);
      return { status: 200, headers: {}, body: inboundMessageJson() };
    },
  });
  client.on("MESSAGE_CREATE", async (message) => {
    await client.rest.createMessage(message.channel_id, { content: "pong" });
  });
  let identifyIntents: number | undefined;
  for (let index = 0; index < gateway.sent.length; index += 1) {
    const text = gateway.sent[index];
    if (text === undefined) {
      continue;
    }
    const payload: unknown = JSON.parse(text);
    if (
      typeof payload === "object" &&
      payload !== null &&
      "op" in payload &&
      payload.op === 2 &&
      "d" in payload &&
      typeof payload.d === "object" &&
      payload.d !== null &&
      "intents" in payload.d &&
      typeof payload.d.intents === "number"
    ) {
      identifyIntents = payload.d.intents;
    }
  }
  assert.equal(identifyIntents, PING_INTENTS);
  gateway.inbound(typicalMessageCreateDispatch());
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(restCalls.length, 1);
  const call = restCalls[0];
  assert.ok(call !== undefined);
  assert.equal(call.method, "POST");
  assert.equal(call.url, "https://discord.com/api/v10/channels/20/messages");
  assert.equal(call.body, '{"content":"pong"}');
  assert.equal(call.headers["Content-Type"], "application/json");
});

test("handler throw does not teardown Session or reject closed", async () => {
  const { client, gateway } = await openPingClient({
    request: async () => ({ status: 200, headers: {}, body: gatewayBotBody() }),
  });
  client.on("MESSAGE_CREATE", () => {
    throw new Error("handler boom");
  });
  let closedSettled = false;
  void client.closed.then(
    () => {
      closedSettled = true;
    },
    () => {
      closedSettled = true;
    },
  );
  gateway.inbound(typicalMessageCreateDispatch());
  await Promise.resolve();
  assert.equal(closedSettled, false);
  assert.equal(gateway.closeCodes.length, 0);
});

test("rejected handler Promise does not teardown Session or reject closed", async () => {
  const { client, gateway } = await openPingClient({
    request: async () => ({ status: 200, headers: {}, body: gatewayBotBody() }),
  });
  client.on("MESSAGE_CREATE", () => Promise.reject(new Error("handler boom")));
  let closedSettled = false;
  void client.closed.then(
    () => {
      closedSettled = true;
    },
    () => {
      closedSettled = true;
    },
  );
  let unhandled = 0;
  const onUnhandled = () => {
    unhandled += 1;
  };
  process.on("unhandledRejection", onUnhandled);
  gateway.inbound(typicalMessageCreateDispatch());
  await Promise.resolve();
  await Promise.resolve();
  process.off("unhandledRejection", onUnhandled);
  assert.equal(unhandled, 0);
  assert.equal(closedSettled, false);
  assert.equal(gateway.closeCodes.length, 0);
});
