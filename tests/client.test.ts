import assert from "node:assert/strict";
import { test } from "node:test";
import { Client, ConfigurationError, GatewayIntent } from "moon-discord";
import { createTestClient } from "moon-discord/testing";

test("Client constructs with a Bot token", () => {
  const client = new Client({ token: "bot-token" });
  assert.equal(typeof client.rest, "object");
  assert.notEqual(client.rest, null);
});

test("GatewayIntent named flags combine with bitwise OR", () => {
  assert.equal(GatewayIntent.Guilds, 1);
  assert.equal(GatewayIntent.GuildMessages, 512);
  assert.equal(GatewayIntent.MessageContent, 32768);
  assert.equal(
    GatewayIntent.Guilds | GatewayIntent.GuildMessages | GatewayIntent.MessageContent,
    33281,
  );
});

test("missing intents is a configuration error before connect I/O", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response("{}", { status: 200 });
  };
  try {
    const client = new Client({ token: "bot-token" });
    await assert.rejects(() => client.connect(), (error: unknown) => {
      assert.ok(error instanceof ConfigurationError);
      return true;
    });
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("explicit intents 0 is not a missing-intents configuration error", async () => {
  let opened = false;
  const client = createTestClient(
    { token: "bot-token", intents: 0 },
    {
      http: {
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
      },
      clock: {
        nowMs: () => 0,
        schedule: () => () => {},
      },
      gateway: async () => {
        opened = true;
        return {
          sendText: () => {},
          close: () => {},
        };
      },
    },
  );
  let rejected: unknown;
  const pending = client.connect().then(
    () => {
      rejected = "resolved";
    },
    (error: unknown) => {
      rejected = error;
    },
  );
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 20);
  });
  assert.equal(rejected, undefined);
  assert.equal(opened, true);
  void pending;
});
