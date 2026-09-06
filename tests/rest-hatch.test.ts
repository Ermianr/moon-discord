import assert from "node:assert/strict";
import { test } from "node:test";
import { DiscordHttpError } from "moon-discord";
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

test("execute returns unknown JSON on success without Decode", async () => {
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
          extra: "keep-me",
        }),
      };
    },
  });
  const result: unknown = await client.rest.execute({
    method: "GET",
    path: "/gateway/bot",
  });
  assert.equal(capturedMethod, "GET");
  assert.equal(capturedUrl, "https://discord.com/api/v10/gateway/bot");
  assert.equal(capturedHeaders["Authorization"], "Bot bot-token");
  assert.match(capturedHeaders["User-Agent"] ?? "", /^DiscordBot \(.+, .+\)$/);
  assert.deepEqual(result, {
    url: "wss://gateway.discord.gg/",
    extra: "keep-me",
  });
});

test("execute sets URL-encoded X-Audit-Log-Reason when auditReason is provided", async () => {
  let capturedHeaders: Record<string, string> = {};
  const client = createClientWithHttp({
    request: async (request) => {
      capturedHeaders = request.headers;
      return {
        status: 204,
        headers: {},
        body: "",
      };
    },
  });
  await client.rest.execute({
    method: "DELETE",
    path: "/guilds/1/members/2",
    auditReason: "banned for spam & café",
  });
  assert.equal(capturedHeaders["X-Audit-Log-Reason"], "banned%20for%20spam%20%26%20caf%C3%A9");
  assert.equal(capturedHeaders["Authorization"], "Bot bot-token");
});

test("execute sends JSON body and query on the Rest HTTP adapter", async () => {
  let capturedUrl = "";
  let capturedHeaders: Record<string, string> = {};
  let capturedBody: string | Uint8Array | undefined;
  const client = createClientWithHttp({
    request: async (request) => {
      capturedUrl = request.url;
      capturedHeaders = request.headers;
      capturedBody = request.body;
      return {
        status: 200,
        headers: {},
        body: "{}",
      };
    },
  });
  await client.rest.execute({
    method: "POST",
    path: "/channels/1/messages",
    query: { wait: "true" },
    body: { content: "hello" },
  });
  assert.equal(capturedUrl, "https://discord.com/api/v10/channels/1/messages?wait=true");
  assert.equal(capturedHeaders["Content-Type"], "application/json");
  assert.equal(capturedBody, '{"content":"hello"}');
});

test("execute keeps files as a sibling list and does not send them inside JSON body", async () => {
  let capturedHeaders: Record<string, string> = {};
  let capturedBody: string | Uint8Array | undefined;
  const client = createClientWithHttp({
    request: async (request) => {
      capturedHeaders = request.headers;
      capturedBody = request.body;
      return {
        status: 200,
        headers: {},
        body: "{}",
      };
    },
  });
  await client.rest.execute({
    method: "POST",
    path: "/channels/1/messages",
    body: { content: "hello" },
    files: [{ filename: "a.txt", bytes: new Uint8Array([97]) }],
  });
  assert.match(capturedHeaders["Content-Type"] ?? "", /^multipart\/form-data; boundary=/);
  assert.ok(capturedBody instanceof Uint8Array);
  const latin1 = Buffer.from(capturedBody).toString("latin1");
  assert.equal(latin1.includes('name="payload_json"'), true);
  assert.equal(latin1.includes('{"content":"hello"}'), true);
  assert.equal(latin1.includes('"files"'), false);
});

test("execute with empty files stays JSON on the Rest HTTP adapter", async () => {
  let capturedHeaders: Record<string, string> = {};
  let capturedBody: string | Uint8Array | undefined;
  const client = createClientWithHttp({
    request: async (request) => {
      capturedHeaders = request.headers;
      capturedBody = request.body;
      return {
        status: 200,
        headers: {},
        body: "{}",
      };
    },
  });
  await client.rest.execute({
    method: "POST",
    path: "/channels/1/messages",
    body: { content: "hello" },
    files: [],
  });
  assert.equal(capturedHeaders["Content-Type"], "application/json");
  assert.equal(capturedBody, '{"content":"hello"}');
});

test("execute rejects Discord HTTP errors instead of returning the body as unknown", async () => {
  const client = createClientWithHttp({
    request: async () => ({
      status: 400,
      headers: {},
      body: JSON.stringify({ extra: true, message: "Invalid Form Body", code: 50035 }),
    }),
  });
  await assert.rejects(
    () => client.rest.execute({ method: "GET", path: "/users/@me" }),
    (error: unknown) => {
      assert.ok(error instanceof DiscordHttpError);
      assert.equal(error.status, 400);
      return true;
    },
  );
});
