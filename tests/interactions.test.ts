import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigurationError, GatewayIntent } from "moon-discord";
import { createTestClient } from "moon-discord/testing";
import type { Clock, GatewayConnect, GatewayConnectionHandlers, RestHttp, RestHttpRequest } from "moon-discord/testing";

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

function exampleInboundMessageJson(): string {
  return JSON.stringify({
    reactions: [],
    attachments: [],
    tts: false,
    embeds: [],
    timestamp: "2017-07-11T17:27:07.299000+00:00",
    mention_everyone: false,
    id: "334385199974967042",
    pinned: false,
    edited_timestamp: null,
    author: {
      username: "Mason",
      discriminator: "9999",
      id: "53908099506183680",
      avatar: "a_bab14f271d565501444b2ca3be944b25",
    },
    mention_roles: [],
    content: "Supa Hot",
    channel_id: "290926798999357250",
    mentions: [],
    type: 0,
  });
}

function interactionPayload(): object {
  return {
    id: "987654321098765432",
    application_id: "613425648685547541",
    type: 2,
    token: "interaction-token",
    version: 1,
    entitlements: [{ id: "1", extra: true }],
    authorizing_integration_owners: { "0": "41771983423143937" },
    attachment_size_limit: 26214400,
    data: { id: "1107321043549765632", name: "blep", type: 1, extra: true },
    guild_id: "41771983423143937",
    channel_id: "290926798999357250",
    extra: "drop-me",
  };
}

function currentApplicationBody(): string {
  return JSON.stringify({ id: "613425648685547541", flags: 0 });
}

type MemoryGateway = {
  connect: GatewayConnect;
  sent: string[];
  inbound: (text: string) => void;
  waitOpens: (count: number) => Promise<void>;
};

function createMemoryGateway(): MemoryGateway {
  const handlers: GatewayConnectionHandlers[] = [];
  const sent: string[] = [];
  const urls: string[] = [];
  let notifyOpens = () => {};
  const connect: GatewayConnect = async (_url, next) => {
    urls.push(_url);
    handlers.push(next);
    notifyOpens();
    return {
      sendText: (text) => {
        sent.push(text);
      },
      close: () => {},
    };
  };
  return {
    connect,
    sent,
    inbound: (text) => {
      const current = handlers[handlers.length - 1];
      if (current !== undefined) {
        current.onText(text);
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

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function waitBound(gateway: MemoryGateway, count: number): Promise<void> {
  await gateway.waitOpens(count);
  await Promise.resolve();
  await Promise.resolve();
}

function hello(): string {
  return JSON.stringify({ op: 10, d: { heartbeat_interval: 1000 } });
}

function readyDispatch(applicationId?: string): string {
  const d: {
    session_id: string;
    resume_gateway_url: string;
    user: { id: string; username: string; discriminator: string; avatar: null };
    guilds: [];
    application?: { id: string; flags: number };
  } = {
    session_id: "session-1",
    resume_gateway_url: "wss://resume.discord.gg",
    user: { id: "1", username: "bot", discriminator: "0", avatar: null },
    guilds: [],
  };
  if (applicationId !== undefined) {
    d.application = { id: applicationId, flags: 0 };
  }
  return JSON.stringify({ op: 0, s: 1, t: "READY", d });
}

async function connectReady(http: RestHttp, gateway: MemoryGateway, clock: ManualClock, applicationId?: string) {
  const client = createTestClient(
    { token: "bot-token", intents: GatewayIntent.Guilds },
    { http, clock, gateway: gateway.connect },
  );
  void client.closed.then(
    () => {},
    () => {},
  );
  const connectPromise = client.connect();
  await waitBound(gateway, 1);
  gateway.inbound(hello());
  clock.advance(1000);
  gateway.inbound(JSON.stringify({ op: 11, d: null }));
  gateway.inbound(readyDispatch(applicationId));
  await connectPromise;
  return client;
}

test("on(INTERACTION_CREATE) receives the inbound interaction and answers through Rest", async () => {
  const httpCalls: RestHttpRequest[] = [];
  const clock = createManualClock();
  const gateway = createMemoryGateway();
  const client = await connectReady(
    {
      request: async (request) => {
        httpCalls.push(request);
        if (request.url.endsWith("/gateway/bot")) {
          return { status: 200, headers: {}, body: gatewayBotBody() };
        }
        if (request.url.includes("/callback")) {
          return { status: 204, headers: {}, body: "" };
        }
        throw new Error(`unexpected Rest ${request.method} ${request.url}`);
      },
    },
    gateway,
    clock,
  );
  const received: string[] = [];
  client.on("INTERACTION_CREATE", async (interaction) => {
    received.push(interaction.id);
    assert.equal(interaction.application_id, "613425648685547541");
    assert.equal(interaction.token, "interaction-token");
    assert.equal(interaction.data?.name, "blep");
    assert.equal("extra" in interaction, false);
    assert.equal(interaction.data !== undefined && "extra" in interaction.data, false);
    await client.rest.createInteractionResponse(interaction.id, interaction.token, {
      type: 4,
      data: { content: "acked" },
    });
  });
  gateway.inbound(
    JSON.stringify({
      op: 0,
      s: 2,
      t: "INTERACTION_CREATE",
      d: interactionPayload(),
    }),
  );
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(received, ["987654321098765432"]);
  const callback = httpCalls.find((request) => request.url.includes("/callback"));
  assert.equal(callback?.method, "POST");
  assert.equal(
    callback?.url,
    "https://discord.com/api/v10/interactions/987654321098765432/interaction-token/callback",
  );
  assert.equal(callback?.body, '{"type":4,"data":{"content":"acked"}}');
  for (let index = 0; index < gateway.sent.length; index += 1) {
    const frame = gateway.sent[index];
    if (frame !== undefined) {
      assert.equal(frame.includes("interaction-token"), false);
    }
  }
});

test("callback and followup routes skip the global 50 rps cap", async () => {
  const clock = createManualClock();
  const urls: string[] = [];
  const client = createTestClient(
    { token: "bot-token" },
    {
      clock,
      http: {
        request: async (request) => {
          urls.push(request.url);
          if (request.url.endsWith("/gateway/bot")) {
            return { status: 200, headers: {}, body: gatewayBotBody() };
          }
          if (request.url.endsWith("/applications/@me")) {
            return { status: 200, headers: {}, body: currentApplicationBody() };
          }
          if (request.url.includes("/callback")) {
            return { status: 204, headers: {}, body: "" };
          }
          if (request.url.includes("/webhooks/")) {
            return { status: 200, headers: {}, body: exampleInboundMessageJson() };
          }
          return { status: 200, headers: {}, body: exampleInboundMessageJson() };
        },
      },
    },
  );
  await client.rest.createFollowupMessage("warmup-token", { content: "cache application.id" });
  clock.advance(1000);
  urls.length = 0;
  for (let i = 0; i < 50; i += 1) {
    await client.rest.getGatewayBot();
  }
  assert.equal(urls.length, 50);
  await client.rest.createInteractionResponse("1", "callback-token", { type: 4, data: { content: "hi" } });
  assert.equal(urls.length, 51);
  await client.rest.createFollowupMessage("followup-token", { content: "later" });
  assert.equal(urls.length, 52);
  assert.ok(urls[50]?.includes("/interactions/1/callback-token/callback"));
  assert.ok(urls[51]?.includes("/webhooks/613425648685547541/followup-token"));
});

test("interaction callback honors per-route 429 via Clock", async () => {
  const clock = createManualClock();
  let httpCalls = 0;
  const client = createTestClient(
    { token: "bot-token" },
    {
      clock,
      http: {
        request: async (request) => {
          if (request.url.includes("/callback")) {
            httpCalls += 1;
            if (httpCalls === 1) {
              return {
                status: 429,
                headers: { "Retry-After": "1" },
                body: JSON.stringify({ retry_after: 1 }),
              };
            }
            return { status: 204, headers: {}, body: "" };
          }
          throw new Error(`unexpected Rest ${request.method} ${request.url}`);
        },
      },
    },
  );
  const pending = client.rest.createInteractionResponse("1", "callback-token", { type: 4 });
  await flush();
  assert.equal(httpCalls, 1);
  clock.advance(1000);
  await pending;
  assert.equal(httpCalls, 2);
});

test("READY application.id is used on command routes without GET /applications/@me", async () => {
  const clock = createManualClock();
  const gateway = createMemoryGateway();
  const urls: string[] = [];
  const client = await connectReady(
    {
      request: async (request) => {
        urls.push(request.url);
        if (request.url.endsWith("/gateway/bot")) {
          return { status: 200, headers: {}, body: gatewayBotBody() };
        }
        if (request.url.endsWith("/applications/@me")) {
          throw new Error("lazy application GET should not run after READY");
        }
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            id: "1107321043549765632",
            application_id: "613425648685547541",
            name: "blep",
            description: "x",
            default_member_permissions: null,
            version: "1",
          }),
        };
      },
    },
    gateway,
    clock,
    "613425648685547541",
  );
  await client.rest.createGlobalApplicationCommand({ name: "blep", description: "x" });
  assert.equal(
    urls.some((url) => url.endsWith("/applications/@me")),
    false,
  );
  assert.equal(
    urls[urls.length - 1],
    "https://discord.com/api/v10/applications/613425648685547541/commands",
  );
});

test("connect then handleInteractionRequest is ConfigurationError", async () => {
  const clock = createManualClock();
  const gateway = createMemoryGateway();
  const client = await connectReady(
    {
      request: async () => ({ status: 200, headers: {}, body: gatewayBotBody() }),
    },
    gateway,
    clock,
  );
  await assert.rejects(
    () => client.handleInteractionRequest({ body: "{}", headers: {} }),
    (error: unknown) => error instanceof ConfigurationError,
  );
});

test("handleInteractionRequest then connect is ConfigurationError", async () => {
  const client = createTestClient(
    { token: "bot-token", intents: GatewayIntent.Guilds, publicKey: "aa" },
    {
      http: {
        request: async () => {
          throw new Error("connect must fail before Discord I/O");
        },
      },
      clock: {
        nowMs: () => 0,
        schedule: () => () => {},
      },
    },
  );
  await assert.rejects(
    () => client.handleInteractionRequest({ body: "{}", headers: {} }),
    (error: unknown) => error instanceof ConfigurationError,
  );
  await assert.rejects(
    () => client.connect(),
    (error: unknown) => {
      assert.ok(error instanceof ConfigurationError);
      assert.match(error.message, /handleInteractionRequest/);
      return true;
    },
  );
});
