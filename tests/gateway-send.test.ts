import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CancelledError,
  ConfigurationError,
  GATEWAY_SEND_QUEUE,
  GATEWAY_SESSION_WAIT_MS,
  GatewayIntent,
  SaturatedError,
} from "moon-discord";
import { createTestClient } from "moon-discord/testing";
import type { Clock, GatewayConnect, GatewayConnectionHandlers, RestHttp } from "moon-discord/testing";

type ManualClock = Clock & { advance: (ms: number) => void };

const OWNED_GUILD = "613425648685547541";
const FOREIGN_GUILD = "41771983444115456";

const PRESENCE = { since: null, activities: [], status: "online", afk: false };

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

function gatewayBotHttp(): RestHttp {
  return {
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
  };
}

type MemoryGateway = {
  connect: GatewayConnect;
  urls: string[];
  closeCodes: number[];
  sent: string[];
  inbound: (text: string) => void;
  remoteClose: (code: number | undefined) => void;
  waitOpens: (count: number) => Promise<void>;
};

function createMemoryGateway(): MemoryGateway {
  const urls: string[] = [];
  const closeCodes: number[] = [];
  const sent: string[] = [];
  const handlers: GatewayConnectionHandlers[] = [];
  let notifyOpens = () => {};
  const connect: GatewayConnect = async (url, next) => {
    urls.push(url);
    handlers.push(next);
    notifyOpens();
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
    urls,
    closeCodes,
    sent,
    inbound: (text) => {
      const current = handlers[handlers.length - 1];
      if (current !== undefined) {
        current.onText(text);
      }
    },
    remoteClose: (code) => {
      const current = handlers[handlers.length - 1];
      if (current !== undefined) {
        current.onClose(code);
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

async function waitBound(gateway: MemoryGateway, count: number): Promise<void> {
  await gateway.waitOpens(count);
  await Promise.resolve();
  await Promise.resolve();
}

function hello(heartbeatInterval: number): string {
  return JSON.stringify({ op: 10, d: { heartbeat_interval: heartbeatInterval } });
}

function readyDispatch(): string {
  return JSON.stringify({
    op: 0,
    s: 1,
    t: "READY",
    d: {
      session_id: "session-1",
      resume_gateway_url: "wss://resume.discord.gg",
      user: {
        id: "1",
        username: "bot",
        discriminator: "0",
        avatar: null,
      },
      guilds: [],
    },
  });
}

function parseSent(gateway: MemoryGateway): unknown[] {
  return gateway.sent.map((text) => JSON.parse(text) as unknown);
}

function ops(gateway: MemoryGateway): number[] {
  const found: number[] = [];
  const payloads = parseSent(gateway);
  for (let index = 0; index < payloads.length; index += 1) {
    const payload = payloads[index];
    if (typeof payload === "object" && payload !== null && "op" in payload && typeof payload.op === "number") {
      found.push(payload.op);
    }
  }
  return found;
}

async function readyClient(options?: { shards?: { id: number; count: number } }) {
  const clock = createManualClock();
  const gateway = createMemoryGateway();
  const client = createTestClient(
    {
      token: "bot-token",
      intents: GatewayIntent.Guilds,
      ...(options?.shards === undefined ? {} : { shards: options.shards }),
    },
    { http: gatewayBotHttp(), clock, gateway: gateway.connect },
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
  await waitBound(gateway, 1);
  gateway.inbound(hello(1000));
  clock.advance(1000);
  gateway.inbound(JSON.stringify({ op: 11, d: null }));
  gateway.inbound(readyDispatch());
  await connectPromise;
  gateway.sent.length = 0;
  return { client, clock, gateway };
}

test("exported Gateway send caps are 120 and 60_000", () => {
  assert.equal(GATEWAY_SEND_QUEUE, 120);
  assert.equal(GATEWAY_SESSION_WAIT_MS, 60_000);
});

test("Gateway send before connect has resolved is ConfigurationError", async () => {
  const { client, connectPromise } = await (async () => {
    const clock = createManualClock();
    const gateway = createMemoryGateway();
    const client = createTestClient(
      { token: "bot-token", intents: GatewayIntent.Guilds },
      { http: gatewayBotHttp(), clock, gateway: gateway.connect },
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
    await waitBound(gateway, 1);
    return { client, connectPromise };
  })();
  await assert.rejects(() => client.updatePresence(PRESENCE), (error: unknown) => {
    assert.ok(error instanceof ConfigurationError);
    return true;
  });
  await assert.rejects(
    () => client.updateVoiceState({ guild_id: OWNED_GUILD, channel_id: null, self_mute: false, self_deaf: false }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigurationError);
      return true;
    },
  );
  void connectPromise;
});

test("updatePresence sends opcode 3 to a Ready Session", async () => {
  const { client, gateway } = await readyClient();
  await client.updatePresence(PRESENCE);
  assert.deepEqual(parseSent(gateway)[0], { op: 3, d: PRESENCE });
});

test("updateVoiceState, requestGuildMembers, requestSoundboardSounds, and requestChannelInfo match Gateway opcodes", async () => {
  const { client, gateway } = await readyClient();
  await client.updateVoiceState({
    guild_id: OWNED_GUILD,
    channel_id: "127121515262115840",
    self_mute: false,
    self_deaf: false,
  });
  await client.requestGuildMembers({ guild_id: OWNED_GUILD, query: "", limit: 0, nonce: "n1" });
  await client.requestSoundboardSounds({ guild_ids: [OWNED_GUILD] });
  await client.requestChannelInfo({ guild_id: OWNED_GUILD, fields: ["status", "voice_start_time"] });
  assert.deepEqual(parseSent(gateway), [
    {
      op: 4,
      d: {
        guild_id: OWNED_GUILD,
        channel_id: "127121515262115840",
        self_mute: false,
        self_deaf: false,
      },
    },
    { op: 8, d: { guild_id: OWNED_GUILD, query: "", limit: 0, nonce: "n1" } },
    { op: 31, d: { guild_ids: [OWNED_GUILD] } },
    { op: 43, d: { guild_id: OWNED_GUILD, fields: ["status", "voice_start_time"] } },
  ]);
});

test("requestGuildMembers does not invent a nonce", async () => {
  const { client, gateway } = await readyClient();
  await client.requestGuildMembers({ guild_id: OWNED_GUILD, query: "", limit: 0 });
  assert.deepEqual(parseSent(gateway)[0], { op: 8, d: { guild_id: OWNED_GUILD, query: "", limit: 0 } });
});

test("requestGuildMembers nonce over 32 bytes is ConfigurationError", async () => {
  const { client, gateway } = await readyClient();
  await assert.rejects(
    () => client.requestGuildMembers({ guild_id: OWNED_GUILD, query: "", limit: 0, nonce: "n".repeat(33) }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigurationError);
      return true;
    },
  );
  assert.equal(gateway.sent.length, 0);
});

test("guild send targeting a shard this process does not own is ConfigurationError", async () => {
  const { client, gateway } = await readyClient({ shards: { id: 0, count: 2 } });
  await assert.rejects(
    () => client.updateVoiceState({ guild_id: FOREIGN_GUILD, channel_id: null, self_mute: false, self_deaf: false }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigurationError);
      return true;
    },
  );
  await assert.rejects(
    () => client.requestSoundboardSounds({ guild_ids: [FOREIGN_GUILD] }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigurationError);
      return true;
    },
  );
  assert.equal(gateway.sent.length, 0);
});

test("last presence is attached to later Identify, not Resume, and not the first Identify of a new connect", async () => {
  const clock = createManualClock();
  const gateway = createMemoryGateway();
  let botCalls = 0;
  const client = createTestClient(
    { token: "bot-token", intents: GatewayIntent.Guilds },
    {
      http: {
        request: async () => {
          botCalls += 1;
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
        },
      },
      clock,
      gateway: gateway.connect,
    },
  );
  void client.closed.then(
    () => {},
    () => {},
  );
  const firstConnect = client.connect();
  firstConnect.then(
    () => {},
    () => {},
  );
  await waitBound(gateway, 1);
  gateway.inbound(hello(1000));
  clock.advance(1000);
  gateway.inbound(JSON.stringify({ op: 11, d: null }));
  gateway.inbound(readyDispatch());
  await firstConnect;
  await client.updatePresence(PRESENCE);
  gateway.inbound(JSON.stringify({ op: 9, d: false }));
  clock.advance(2000);
  await gateway.waitOpens(2);
  gateway.sent.length = 0;
  gateway.inbound(hello(1000));
  clock.advance(1000);
  const identify = parseSent(gateway).find((payload) => {
    return typeof payload === "object" && payload !== null && "op" in payload && payload.op === 2;
  }) as { d: { presence: unknown } };
  assert.deepEqual(identify.d.presence, PRESENCE);

  gateway.inbound(
    JSON.stringify({
      op: 0,
      s: 2,
      t: "READY",
      d: {
        session_id: "session-2",
        resume_gateway_url: "wss://resume.discord.gg",
        user: { id: "1", username: "bot", discriminator: "0", avatar: null },
        guilds: [],
      },
    }),
  );
  gateway.inbound(JSON.stringify({ op: 7, d: null }));
  await gateway.waitOpens(3);
  gateway.sent.length = 0;
  gateway.inbound(hello(1000));
  clock.advance(1000);
  const resume = parseSent(gateway).find((payload) => {
    return typeof payload === "object" && payload !== null && "op" in payload && payload.op === 6;
  }) as { d: Record<string, unknown> };
  assert.equal("presence" in resume.d, false);

  await client.disconnect();
  const secondConnect = client.connect();
  secondConnect.then(
    () => {},
    () => {},
  );
  await waitBound(gateway, 4);
  gateway.sent.length = 0;
  gateway.inbound(hello(1000));
  clock.advance(1000);
  const brandNewIdentify = parseSent(gateway).find((payload) => {
    return typeof payload === "object" && payload !== null && "op" in payload && payload.op === 2;
  }) as { d: Record<string, unknown> };
  assert.ok(brandNewIdentify !== undefined);
  assert.equal("presence" in brandNewIdentify.d, false);
  assert.equal(botCalls, 2);
});

test("requestGuildMembers resolves when paced; chunks arrive as GUILD_MEMBERS_CHUNK", async () => {
  const { client, gateway } = await readyClient();
  const chunks: unknown[] = [];
  client.on("GUILD_MEMBERS_CHUNK", (payload) => {
    chunks.push(payload);
  });
  await client.requestGuildMembers({ guild_id: OWNED_GUILD, query: "", limit: 0, nonce: "owned-nonce" });
  assert.equal(ops(gateway).includes(8), true);
  gateway.inbound(
    JSON.stringify({
      op: 0,
      s: 2,
      t: "GUILD_MEMBERS_CHUNK",
      d: {
        guild_id: OWNED_GUILD,
        members: [],
        chunk_index: 0,
        chunk_count: 1,
        nonce: "owned-nonce",
      },
    }),
  );
  assert.deepEqual(chunks[0], {
    guild_id: OWNED_GUILD,
    members: [],
    chunk_index: 0,
    chunk_count: 1,
    nonce: "owned-nonce",
  });
});

test("RATE_LIMITED is on(t), not a throw", async () => {
  const { client, gateway } = await readyClient();
  const limited: unknown[] = [];
  client.on("RATE_LIMITED", (payload) => {
    limited.push(payload);
  });
  await client.requestGuildMembers({ guild_id: OWNED_GUILD, query: "", limit: 0, nonce: "n" });
  gateway.inbound(
    JSON.stringify({
      op: 0,
      s: 2,
      t: "RATE_LIMITED",
      d: { opcode: 8, retry_after: 3, meta: { guild_id: OWNED_GUILD, nonce: "n" } },
    }),
  );
  assert.deepEqual(limited[0], {
    opcode: 8,
    retry_after: 3,
    meta: { guild_id: OWNED_GUILD, nonce: "n" },
  });
});

test("JSON over 4096 UTF-8 bytes is ConfigurationError without closing the socket", async () => {
  const { client, gateway } = await readyClient();
  const oversized = { since: null, activities: [{ name: "n".repeat(5000), type: 0 }], status: "online", afk: false };
  await assert.rejects(() => client.updatePresence(oversized), (error: unknown) => {
    assert.ok(error instanceof ConfigurationError);
    return true;
  });
  assert.equal(gateway.closeCodes.length, 0);
  await client.updatePresence(PRESENCE);
  assert.deepEqual(parseSent(gateway)[0], { op: 3, d: PRESENCE });
});

test("Heartbeat is not queued behind application sends", async () => {
  const { client, gateway } = await readyClient();
  const pending: Promise<void>[] = [];
  for (let index = 0; index < GATEWAY_SEND_QUEUE; index += 1) {
    pending.push(client.requestGuildMembers({ guild_id: OWNED_GUILD, query: "", limit: 0 }));
  }
  await Promise.all(pending);
  const waiting = client.requestGuildMembers({ guild_id: OWNED_GUILD, user_ids: ["1"] });
  waiting.then(
    () => {},
    () => {},
  );
  gateway.inbound(JSON.stringify({ op: 1, d: null }));
  assert.deepEqual(JSON.parse(gateway.sent[gateway.sent.length - 1] ?? ""), { op: 1, d: 1 });
  const waitingOps = ops(gateway).filter((code) => code === 8);
  assert.equal(waitingOps.length, GATEWAY_SEND_QUEUE);
});

test("newest Gateway send is SaturatedError gateway_queue when the queue is full", async () => {
  const { client } = await readyClient();
  const held: Promise<void>[] = [];
  for (let index = 0; index < GATEWAY_SEND_QUEUE; index += 1) {
    held.push(client.requestGuildMembers({ guild_id: OWNED_GUILD, query: "", limit: 0 }));
  }
  await Promise.all(held);
  const queued: Promise<void>[] = [];
  for (let index = 0; index < GATEWAY_SEND_QUEUE; index += 1) {
    queued.push(client.requestGuildMembers({ guild_id: OWNED_GUILD, query: "q", limit: 1 }));
  }
  await assert.rejects(
    () => client.requestGuildMembers({ guild_id: OWNED_GUILD, query: "overflow", limit: 1 }),
    (error: unknown) => {
      assert.ok(error instanceof SaturatedError);
      assert.equal(error.kind, "gateway_queue");
      return true;
    },
  );
  queued.forEach((promise) => {
    promise.then(
      () => {},
      () => {},
    );
  });
});

test("guild send waits until the Session is Ready, then SaturatedError gateway_session_wait", async () => {
  const { client, clock, gateway } = await readyClient();
  gateway.inbound(JSON.stringify({ op: 7, d: null }));
  await gateway.waitOpens(2);
  const waiting = client.updateVoiceState({
    guild_id: OWNED_GUILD,
    channel_id: null,
    self_mute: false,
    self_deaf: false,
  });
  waiting.then(
    () => {},
    () => {},
  );
  clock.advance(GATEWAY_SESSION_WAIT_MS);
  await assert.rejects(() => waiting, (error: unknown) => {
    assert.ok(error instanceof SaturatedError);
    assert.equal(error.kind, "gateway_session_wait");
    return true;
  });
});

test("disconnect cancels waiting Gateway sends with CancelledError", async () => {
  const { client, gateway } = await readyClient();
  gateway.inbound(JSON.stringify({ op: 7, d: null }));
  await gateway.waitOpens(2);
  const waiting = client.requestChannelInfo({ guild_id: OWNED_GUILD, fields: ["status"] });
  waiting.then(
    () => {},
    () => {},
  );
  await client.disconnect();
  await assert.rejects(() => waiting, (error: unknown) => {
    assert.ok(error instanceof CancelledError);
    return true;
  });
});
