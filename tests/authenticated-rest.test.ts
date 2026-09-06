import assert from "node:assert/strict";
import { test } from "node:test";
import { DecodeError } from "moon-discord";
import { createTestClient } from "moon-discord/testing";
import type { RestHttp } from "moon-discord/testing";

function createClientWithHttp(http: RestHttp) {
  return createTestClient(
    { token: "bot-token" },
    {
      http,
      clock: {
        nowMs: () => 0,
        schedule: () => () => {},
      },
    },
  );
}

test("getGatewayBot sends Bot Authorization and decodes url, shards, and session_start_limit", async () => {
  let capturedMethod = "";
  let capturedUrl = "";
  let capturedHeaders: Record<string, string> = {};
  const client = createClientWithHttp({
    request: async (request) => {
      capturedMethod = request.method;
      capturedUrl = request.url;
      capturedHeaders = request.headers;
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          url: "wss://gateway.discord.gg/",
          shards: 9,
          session_start_limit: {
            total: 1000,
            remaining: 999,
            reset_after: 14400000,
            max_concurrency: 1,
            extra: true,
          },
          extra: "drop-me",
        }),
      };
    },
  });
  const gateway = await client.rest.getGatewayBot();
  assert.equal(capturedMethod, "GET");
  assert.equal(capturedUrl, "https://discord.com/api/v10/gateway/bot");
  assert.equal(capturedHeaders["Authorization"], "Bot bot-token");
  assert.match(capturedHeaders["User-Agent"] ?? "", /^DiscordBot \(.+, .+\)$/);
  assert.equal(gateway.url, "wss://gateway.discord.gg/");
  assert.equal(gateway.shards, 9);
  assert.deepEqual(gateway.session_start_limit, {
    total: 1000,
    remaining: 999,
    reset_after: 14400000,
    max_concurrency: 1,
  });
  assert.equal(Object.keys(gateway).join(","), "url,shards,session_start_limit");
});

function exampleInboundMessageJson(): string {
  return JSON.stringify({
    reactions: [{ extra: true }],
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
      extra: "drop-me",
    },
    mention_roles: [],
    content: "Supa Hot",
    channel_id: "290926798999357250",
    mentions: [],
    type: 0,
  });
}

function exampleInboundMessageJsonWith(overrides: Record<string, unknown>): string {
  const parsed: unknown = JSON.parse(exampleInboundMessageJson());
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("example inbound message must be an object");
  }
  return JSON.stringify({ ...parsed, ...overrides });
}

test("createMessage posts JSON to a Snowflake channel path and decodes the inbound message", async () => {
  let capturedMethod = "";
  let capturedUrl = "";
  let capturedHeaders: Record<string, string> = {};
  let capturedBody: string | Uint8Array | undefined;
  const client = createClientWithHttp({
    request: async (request) => {
      capturedMethod = request.method;
      capturedUrl = request.url;
      capturedHeaders = request.headers;
      capturedBody = request.body;
      return {
        status: 200,
        headers: {},
        body: exampleInboundMessageJson(),
      };
    },
  });
  const message = await client.rest.createMessage("290926798999357250", { content: "Hello, World!" });
  assert.equal(capturedMethod, "POST");
  assert.equal(capturedUrl, "https://discord.com/api/v10/channels/290926798999357250/messages");
  assert.equal(capturedHeaders["Authorization"], "Bot bot-token");
  assert.equal(capturedHeaders["Content-Type"], "application/json");
  assert.equal(capturedBody, '{"content":"Hello, World!"}');
  assert.equal(message.id, "334385199974967042");
  assert.equal(message.channel_id, "290926798999357250");
  assert.equal(message.content, "Supa Hot");
  assert.equal(message.timestamp, "2017-07-11T17:27:07.299000+00:00");
  assert.equal(message.edited_timestamp, null);
  assert.equal(message.author.id, "53908099506183680");
  assert.equal(message.author.username, "Mason");
  assert.equal(Object.keys(message.author).join(","), "id,username,discriminator,avatar");
  assert.equal("reactions" in message, false);
});

test("createMessage omits absent outbound optionals", async () => {
  let capturedBody: string | Uint8Array | undefined;
  const client = createClientWithHttp({
    request: async (request) => {
      capturedBody = request.body;
      return {
        status: 200,
        headers: {},
        body: exampleInboundMessageJson(),
      };
    },
  });
  await client.rest.createMessage("290926798999357250", { content: "pong", tts: true });
  assert.equal(capturedBody, '{"content":"pong","tts":true}');
});

test("createMessage stringifies inbound Snowflake numbers that are safe integers", async () => {
  const client = createClientWithHttp({
    request: async () => ({
      status: 200,
      headers: {},
      body: exampleInboundMessageJsonWith({
        id: 123456789,
        channel_id: 987654321,
        author: {
          username: "Mason",
          discriminator: "9999",
          id: 42,
          avatar: null,
        },
      }),
    }),
  });
  const message = await client.rest.createMessage("1", { content: "pong" });
  assert.equal(message.id, "123456789");
  assert.equal(message.channel_id, "987654321");
  assert.equal(message.author.id, "42");
});

test("createMessage rejects DecodeError when inbound Snowflake is not a string or safe integer", async () => {
  const client = createClientWithHttp({
    request: async () => ({
      status: 200,
      headers: {},
      body: exampleInboundMessageJsonWith({ id: 1.5 }),
    }),
  });
  await assert.rejects(() => client.rest.createMessage("1", { content: "pong" }), (error: unknown) => {
    assert.ok(error instanceof DecodeError);
    return true;
  });
});

test("createMessage rejects DecodeError when inbound Timestamp is not a string", async () => {
  const client = createClientWithHttp({
    request: async () => ({
      status: 200,
      headers: {},
      body: exampleInboundMessageJsonWith({ timestamp: 1499794027299 }),
    }),
  });
  await assert.rejects(() => client.rest.createMessage("1", { content: "pong" }), (error: unknown) => {
    assert.ok(error instanceof DecodeError);
    return true;
  });
});

test("deleteMessage on a documented 204 route resolves void", async () => {
  let capturedMethod = "";
  let capturedUrl = "";
  let capturedHeaders: Record<string, string> = {};
  const client = createClientWithHttp({
    request: async (request) => {
      capturedMethod = request.method;
      capturedUrl = request.url;
      capturedHeaders = request.headers;
      return {
        status: 204,
        headers: {},
        body: "",
      };
    },
  });
  const result = await client.rest.deleteMessage("290926798999357250", "334385199974967042");
  assert.equal(capturedMethod, "DELETE");
  assert.equal(
    capturedUrl,
    "https://discord.com/api/v10/channels/290926798999357250/messages/334385199974967042",
  );
  assert.equal(capturedHeaders["Authorization"], "Bot bot-token");
  assert.equal(result, undefined);
});

test("authenticated Rest works with no connect and no intents", async () => {
  const client = createClientWithHttp({
    request: async (request) => {
      if (request.url.endsWith("/gateway/bot")) {
        return {
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
        };
      }
      return {
        status: 200,
        headers: {},
        body: exampleInboundMessageJson(),
      };
    },
  });
  const gateway = await client.rest.getGatewayBot();
  const message = await client.rest.createMessage("290926798999357250", { content: "pong" });
  assert.equal(gateway.shards, 1);
  assert.equal(message.content, "Supa Hot");
});
