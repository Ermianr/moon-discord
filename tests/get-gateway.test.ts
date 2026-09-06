import assert from "node:assert/strict";
import { test } from "node:test";
import { DecodeError } from "moon-discord";
import { Client as RestClient } from "moon-discord/rest";
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

test("getGateway returns url and drops extra JSON keys", async () => {
  const client = createClientWithHttp({
    request: async () => ({
      status: 200,
      headers: {},
      body: '{"url":"wss://gateway.discord.gg","shards":9}',
    }),
  });
  const gateway = await client.rest.getGateway();
  assert.equal(gateway.url, "wss://gateway.discord.gg");
  assert.equal(Object.keys(gateway).join(","), "url");
});

test("getGateway uses API v10, DiscordBot User-Agent, and no Bot Authorization", async () => {
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
        body: '{"url":"wss://gateway.discord.gg"}',
      };
    },
  });
  await client.rest.getGateway();
  assert.equal(capturedMethod, "GET");
  assert.equal(capturedUrl, "https://discord.com/api/v10/gateway");
  assert.match(capturedHeaders["User-Agent"] ?? "", /^DiscordBot \(.+, .+\)$/);
  assert.equal(capturedHeaders["Authorization"], undefined);
  assert.equal(capturedHeaders["authorization"], undefined);
});

test("getGateway rejects DecodeError when url is missing or not a string", async () => {
  for (const body of ['{"url":1}', "{}", "null"]) {
    const client = createClientWithHttp({
      request: async () => ({
        status: 200,
        headers: {},
        body,
      }),
    });
    await assert.rejects(() => client.rest.getGateway(), (error: unknown) => {
      assert.ok(error instanceof DecodeError);
      return true;
    });
  }
});

test("production Rest HTTP adapter is global fetch with record headers", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  let fetchUrl = "";
  let fetchInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    fetchCalls += 1;
    fetchUrl = String(input);
    fetchInit = init;
    return new Response('{"url":"wss://gateway.discord.gg"}', { status: 200 });
  };
  try {
    const client = new RestClient({ token: "bot-token" });
    const gateway = await client.rest.getGateway();
    assert.equal(gateway.url, "wss://gateway.discord.gg");
    assert.equal(fetchCalls, 1);
    assert.equal(fetchUrl, "https://discord.com/api/v10/gateway");
    assert.equal(fetchInit?.method, "GET");
    const headers = fetchInit?.headers;
    assert.ok(headers !== undefined && headers !== null && typeof headers === "object");
    assert.equal(headers instanceof Headers, false);
    const userAgent: unknown = Reflect.get(headers, "User-Agent");
    assert.equal(typeof userAgent, "string");
    if (typeof userAgent === "string") {
      assert.match(userAgent, /^DiscordBot \(.+, .+\)$/);
    }
    assert.equal(Reflect.get(headers, "Authorization"), undefined);
    assert.equal(fetchInit?.body, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
