import assert from "node:assert/strict";
import { test } from "node:test";
import { createCreateMessageDispatch } from "../src/rest/surface.js";
import type { RestHttp } from "../src/ports.js";

test("createMessage dispatch times JSON POST through Rest HTTP with remaining bucket and no response Decode", async () => {
  let now = 0;
  let capturedAuth = "";
  let capturedUa = "";
  let capturedBody: string | Uint8Array | undefined;
  let capturedContentType = "";
  const http: RestHttp = {
    request: async (request) => {
      capturedAuth = request.headers["Authorization"] ?? "";
      capturedUa = request.headers["User-Agent"] ?? "";
      capturedContentType = request.headers["Content-Type"] ?? "";
      capturedBody = request.body;
      return {
        status: 200,
        headers: {
          "x-ratelimit-bucket": "hot-path",
          "x-ratelimit-remaining": "5",
          "x-ratelimit-reset-after": "60",
        },
        body: "not-json",
      };
    },
  };
  const dispatch = createCreateMessageDispatch(http, "bot-token", {
    nowMs: () => {
      now += 1000;
      return now;
    },
    schedule: () => {
      throw new Error("REST dispatch must not wait on Clock");
    },
  });
  await dispatch("290926798999357250", { content: "Hello, World!" });
  const timed = await dispatch("290926798999357250", { content: "Hello, World!" });
  assert.equal(capturedAuth, "Bot bot-token");
  assert.match(capturedUa, /^DiscordBot \(.+, .+\)$/);
  assert.equal(capturedContentType, "application/json");
  assert.equal(capturedBody, '{"content":"Hello, World!"}');
  assert.equal(timed.status, 200);
  assert.equal(timed.body, "not-json");
});
