import assert from "node:assert/strict";
import { test } from "node:test";
import { Client, ConfigurationError } from "moon-discord/rest";

test("REST-only Client constructs without intents", () => {
  const client = new Client({ token: "bot-token" });
  assert.equal(typeof client.connect, "function");
});

test("connect on the Rest export throws ConfigurationError with no Discord I/O", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response("{}", { status: 200 });
  };
  try {
    const client = new Client({ token: "bot-token", intents: 1 });
    await assert.rejects(() => client.connect(), (error: unknown) => {
      assert.ok(error instanceof ConfigurationError);
      assert.equal(error.name, "ConfigurationError");
      return true;
    });
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Gateway send on the Rest export throws ConfigurationError with no Discord I/O", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response("{}", { status: 200 });
  };
  try {
    const client = new Client({ token: "bot-token", intents: 1 });
    await assert.rejects(() => client.updatePresence({}), (error: unknown) => {
      assert.ok(error instanceof ConfigurationError);
      return true;
    });
    await assert.rejects(() => client.updateVoiceState({}), (error: unknown) => {
      assert.ok(error instanceof ConfigurationError);
      return true;
    });
    await assert.rejects(() => client.requestGuildMembers({}), (error: unknown) => {
      assert.ok(error instanceof ConfigurationError);
      return true;
    });
    await assert.rejects(() => client.requestSoundboardSounds({}), (error: unknown) => {
      assert.ok(error instanceof ConfigurationError);
      return true;
    });
    await assert.rejects(() => client.requestChannelInfo({}), (error: unknown) => {
      assert.ok(error instanceof ConfigurationError);
      return true;
    });
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
