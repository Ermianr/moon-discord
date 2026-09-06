import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigurationError, GatewayIntent } from "moon-discord";
import { createTestClient } from "moon-discord/testing";

test("createTestClient accepts token, intents, shards, http, and clock and returns Client", () => {
  const client = createTestClient(
    {
      token: "bot-token",
      intents: GatewayIntent.Guilds,
      shards: "recommended",
    },
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
  assert.equal(typeof client.rest, "object");
  assert.equal(typeof client.connect, "function");
  assert.equal(typeof client.updatePresence, "function");
});

test("createTestClient connect without intents throws ConfigurationError without HTTP", async () => {
  let httpCalls = 0;
  const client = createTestClient(
    { token: "bot-token" },
    {
      http: {
        request: async () => {
          httpCalls += 1;
          return { status: 200, headers: {}, body: "{}" };
        },
      },
      clock: {
        nowMs: () => 0,
        schedule: () => () => {},
      },
    },
  );
  await assert.rejects(() => client.connect(), (error: unknown) => {
    assert.ok(error instanceof ConfigurationError);
    return true;
  });
  assert.equal(httpCalls, 0);
});
