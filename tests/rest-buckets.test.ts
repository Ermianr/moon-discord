import assert from "node:assert/strict";
import { test } from "node:test";
import { createTestClient } from "moon-discord/testing";
import type { Clock, RestHttp, RestHttpRequest, RestHttpResponse } from "moon-discord/testing";

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

function rateLimitHeaders(fields: {
  bucket: string;
  remaining: string;
  resetAfter: string;
}): Record<string, string> {
  return {
    "X-RateLimit-Bucket": fields.bucket,
    "X-RateLimit-Limit": "5",
    "X-RateLimit-Remaining": fields.remaining,
    "X-RateLimit-Reset-After": fields.resetAfter,
  };
}

function jsonResponse(body: string, headers: Record<string, string>): RestHttpResponse {
  return {
    status: 200,
    headers,
    body,
  };
}

function createClient(http: RestHttp, clock: Clock) {
  return createTestClient({ token: "bot-token" }, { http, clock });
}

test("sequential Rest calls wait until Clock reset when remaining is 0", async () => {
  const clock = createManualClock();
  let httpCalls = 0;
  const client = createClient(
    {
      request: async () => {
        httpCalls += 1;
        return jsonResponse(
          exampleInboundMessageJson(),
          rateLimitHeaders({ bucket: "abcd1234", remaining: "0", resetAfter: "2" }),
        );
      },
    },
    clock,
  );
  await client.rest.createMessage("290926798999357250", { content: "one" });
  assert.equal(httpCalls, 1);
  const second = client.rest.createMessage("290926798999357250", { content: "two" });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(httpCalls, 1);
  clock.advance(1999);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(httpCalls, 1);
  clock.advance(1);
  const message = await second;
  assert.equal(httpCalls, 2);
  assert.equal(message.id, "334385199974967042");
  assert.equal("headers" in message, false);
});

test("same Bucket hash with different channel ids does not wait", async () => {
  const clock = createManualClock();
  const urls: string[] = [];
  const client = createClient(
    {
      request: async (request: RestHttpRequest) => {
        urls.push(request.url);
        return jsonResponse(
          exampleInboundMessageJson(),
          rateLimitHeaders({ bucket: "abcd1234", remaining: "0", resetAfter: "5" }),
        );
      },
    },
    clock,
  );
  await client.rest.createMessage("111111111111111111", { content: "one" });
  await client.rest.createMessage("222222222222222222", { content: "two" });
  assert.deepEqual(urls, [
    "https://discord.com/api/v10/channels/111111111111111111/messages",
    "https://discord.com/api/v10/channels/222222222222222222/messages",
  ]);
});

test("different routes that return the same Bucket hash share remaining", async () => {
  const clock = createManualClock();
  let httpCalls = 0;
  const client = createClient(
    {
      request: async (request: RestHttpRequest) => {
        httpCalls += 1;
        if (request.method === "POST") {
          const remaining = httpCalls === 1 ? "1" : "0";
          return jsonResponse(
            exampleInboundMessageJson(),
            rateLimitHeaders({ bucket: "sharedhash", remaining, resetAfter: "3" }),
          );
        }
        return {
          status: 204,
          headers: rateLimitHeaders({ bucket: "sharedhash", remaining: "0", resetAfter: "3" }),
          body: "",
        };
      },
    },
    clock,
  );
  await client.rest.createMessage("290926798999357250", { content: "one" });
  await client.rest.deleteMessage("290926798999357250", "334385199974967042");
  assert.equal(httpCalls, 2);
  const third = client.rest.createMessage("290926798999357250", { content: "two" });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(httpCalls, 2);
  clock.advance(3000);
  await third;
  assert.equal(httpCalls, 3);
});

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

test("global 50 rps is enforced across routes through Clock", async () => {
  const clock = createManualClock();
  const urls: string[] = [];
  const client = createClient(
    {
      request: async (request: RestHttpRequest) => {
        urls.push(request.url);
        if (request.url.endsWith("/gateway/bot")) {
          return jsonResponse(gatewayBotBody(), {});
        }
        return jsonResponse(exampleInboundMessageJson(), {});
      },
    },
    clock,
  );
  for (let i = 0; i < 50; i += 1) {
    await client.rest.getGatewayBot();
  }
  assert.equal(urls.length, 50);
  const extra = client.rest.createMessage("290926798999357250", { content: "pace" });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(urls.length, 50);
  clock.advance(999);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(urls.length, 50);
  clock.advance(1);
  await extra;
  assert.equal(urls.length, 51);
  assert.equal(urls[50], "https://discord.com/api/v10/channels/290926798999357250/messages");
});

test("Rest hatch sequential calls honor remaining via Clock", async () => {
  const clock = createManualClock();
  let httpCalls = 0;
  const client = createClient(
    {
      request: async () => {
        httpCalls += 1;
        return jsonResponse(
          gatewayBotBody(),
          rateLimitHeaders({ bucket: "gw", remaining: "0", resetAfter: "1" }),
        );
      },
    },
    clock,
  );
  await client.rest.execute({ method: "GET", path: "/gateway/bot" });
  const second = client.rest.execute({ method: "GET", path: "/gateway/bot" });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(httpCalls, 1);
  clock.advance(1000);
  const body: unknown = await second;
  assert.equal(httpCalls, 2);
  assert.equal(typeof body === "object" && body !== null && "url" in body, true);
});
