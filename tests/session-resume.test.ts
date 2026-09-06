import assert from "node:assert/strict";
import { test } from "node:test";
import { DiscordHttpError, GatewayFatalError, GatewayIntent } from "moon-discord";
import { createTestClient } from "moon-discord/testing";
import type { Clock, GatewayConnect, GatewayConnectionHandlers, RestHttp } from "moon-discord/testing";

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

async function connectingClient() {
  const clock = createManualClock();
  const gateway = createMemoryGateway();
  const client = createTestClient(
    { token: "bot-token", intents: GatewayIntent.Guilds },
    { http: gatewayBotHttp(), clock, gateway: gateway.connect },
  );
  const connectPromise = client.connect();
  connectPromise.then(
    () => {},
    () => {},
  );
  client.closed.then(
    () => {},
    () => {},
  );
  await gateway.waitOpens(1);
  await Promise.resolve();
  await Promise.resolve();
  return { client, clock, gateway, connectPromise };
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
      extra: "drop-me",
    },
  });
}

async function readySession() {
  const ctx = await connectingClient();
  ctx.gateway.inbound(hello(1000));
  ctx.clock.advance(1000);
  ctx.gateway.inbound(JSON.stringify({ op: 11, d: null }));
  ctx.gateway.inbound(readyDispatch());
  ctx.gateway.sent.length = 0;
  return ctx;
}

function parseSent(gateway: { sent: string[] }): unknown[] {
  return gateway.sent.map((text) => JSON.parse(text) as unknown);
}

function hasIdentify(payloads: unknown[]): boolean {
  for (let i = 0; i < payloads.length; i += 1) {
    const payload = payloads[i];
    if (typeof payload === "object" && payload !== null && "op" in payload && payload.op === 2) {
      return true;
    }
  }
  return false;
}

async function expectResumeOnNextSocket(clock: ManualClock, gateway: MemoryGateway, expectedUrl: string): Promise<void> {
  assert.equal(gateway.urls[gateway.urls.length - 1], expectedUrl);
  gateway.sent.length = 0;
  gateway.inbound(hello(1000));
  clock.advance(1000);
  const payloads = parseSent(gateway);
  assert.deepEqual(payloads[0], { op: 1, d: 1 });
  assert.deepEqual(payloads[1], {
    op: 6,
    d: { token: "bot-token", session_id: "session-1", seq: 1 },
  });
  assert.equal(hasIdentify(payloads), false);
}

async function expectIdentifyAfterBackoff(clock: ManualClock, gateway: MemoryGateway, opensBefore: number): Promise<void> {
  assert.equal(gateway.urls.length, opensBefore);
  clock.advance(2000);
  await gateway.waitOpens(opensBefore + 1);
  assert.equal(gateway.urls[opensBefore], "wss://gateway.discord.gg/");
  gateway.sent.length = 0;
  gateway.inbound(hello(1000));
  clock.advance(1000);
  const payloads = parseSent(gateway);
  assert.equal(hasIdentify(payloads), true);
  assert.equal(
    payloads.some((payload) => typeof payload === "object" && payload !== null && "op" in payload && payload.op === 6),
    false,
  );
}

test("missing Heartbeat ACK closes the Session with 4000", async () => {
  const { clock, gateway } = await connectingClient();
  gateway.inbound(hello(1000));
  clock.advance(1000);
  clock.advance(1000);
  assert.equal(gateway.closeCodes[0], 4000);
});

test("zombie after READY reconnects the resume URL and Resumes without Identify", async () => {
  const { clock, gateway } = await readySession();
  clock.advance(1000);
  gateway.sent.length = 0;
  clock.advance(1000);
  await gateway.waitOpens(2);
  assert.deepEqual(gateway.closeCodes, [4000]);
  await expectResumeOnNextSocket(clock, gateway, "wss://resume.discord.gg");
});

test("Reconnect op 7 after READY Resumes immediately on the resume URL", async () => {
  const { clock, gateway } = await readySession();
  gateway.inbound(JSON.stringify({ op: 7, d: null }));
  await gateway.waitOpens(2);
  await expectResumeOnNextSocket(clock, gateway, "wss://resume.discord.gg");
});

test("reconnectable close after READY Resumes on the resume URL", async () => {
  const { clock, gateway } = await readySession();
  gateway.remoteClose(4001);
  await gateway.waitOpens(2);
  await expectResumeOnNextSocket(clock, gateway, "wss://resume.discord.gg");
});

test("close with no code after READY Resumes on the resume URL", async () => {
  const { clock, gateway } = await readySession();
  gateway.remoteClose(undefined);
  await gateway.waitOpens(2);
  await expectResumeOnNextSocket(clock, gateway, "wss://resume.discord.gg");
});

test("Invalid Session d true Resumes on the resume URL", async () => {
  const { clock, gateway } = await readySession();
  gateway.inbound(JSON.stringify({ op: 9, d: true }));
  await gateway.waitOpens(2);
  await expectResumeOnNextSocket(clock, gateway, "wss://resume.discord.gg");
});

test("Invalid Session d false Identifies on the cached Get Gateway Bot url after backoff", async () => {
  const { clock, gateway } = await readySession();
  gateway.inbound(JSON.stringify({ op: 9, d: false }));
  await expectIdentifyAfterBackoff(clock, gateway, 1);
});

test("close 4007 Identifies on the cached Get Gateway Bot url after backoff", async () => {
  const { clock, gateway } = await readySession();
  gateway.remoteClose(4007);
  await expectIdentifyAfterBackoff(clock, gateway, 1);
});

test("close 4009 Identifies on the cached Get Gateway Bot url after backoff", async () => {
  const { clock, gateway } = await readySession();
  gateway.remoteClose(4009);
  await expectIdentifyAfterBackoff(clock, gateway, 1);
});

test("Resume too late Identifies on the cached Get Gateway Bot url after backoff", async () => {
  const { clock, gateway } = await readySession();
  gateway.inbound(JSON.stringify({ op: 7, d: null }));
  await gateway.waitOpens(2);
  gateway.inbound(hello(1000));
  clock.advance(1000);
  gateway.inbound(JSON.stringify({ op: 9, d: false }));
  await expectIdentifyAfterBackoff(clock, gateway, 2);
});

test("disconnect closes 1000 and does not reconnect", async () => {
  const { client, clock, gateway } = await readySession();
  await client.disconnect();
  assert.deepEqual(gateway.closeCodes, [1000]);
  clock.advance(2000);
  assert.equal(gateway.urls.length, 1);
});

test("fatal close 4004 after READY rejects closed and does not reconnect", async () => {
  const { clock, gateway, connectPromise, client } = await readySession();
  await connectPromise;
  gateway.remoteClose(4004);
  await assert.rejects(client.closed, (error: unknown) => {
    assert.ok(error instanceof GatewayFatalError);
    assert.equal(error.closeCode, 4004);
    return true;
  });
  clock.advance(2000);
  assert.equal(gateway.urls.length, 1);
});

test("fatal close 4004 before READY rejects connect and closed", async () => {
  const { clock, gateway, connectPromise, client } = await connectingClient();
  gateway.inbound(hello(1000));
  clock.advance(1000);
  gateway.inbound(JSON.stringify({ op: 11, d: null }));
  gateway.remoteClose(4004);
  await assert.rejects(connectPromise, (error: unknown) => {
    assert.ok(error instanceof GatewayFatalError);
    assert.equal(error.closeCode, 4004);
    return true;
  });
  await assert.rejects(client.closed, (error: unknown) => {
    assert.ok(error instanceof GatewayFatalError);
    assert.equal(error.closeCode, 4004);
    return true;
  });
  clock.advance(2000);
  assert.equal(gateway.urls.length, 1);
});

const fatalCodes = [4010, 4011, 4012, 4013, 4014];
for (let i = 0; i < fatalCodes.length; i += 1) {
  const closeCode = fatalCodes[i];
  if (closeCode === undefined) {
    continue;
  }
  test(`fatal close ${String(closeCode)} after READY does not reconnect`, async () => {
    const { clock, gateway, connectPromise, client } = await readySession();
    await connectPromise;
    gateway.remoteClose(closeCode);
    await assert.rejects(client.closed, (error: unknown) => {
      assert.ok(error instanceof GatewayFatalError);
      assert.equal(error.closeCode, closeCode);
      return true;
    });
    clock.advance(2000);
    assert.equal(gateway.urls.length, 1);
  });
}

test("reconnectable close does not reject Client closed", async () => {
  const { gateway, client } = await readySession();
  let closedSettled = false;
  void client.closed.then(
    () => {
      closedSettled = true;
    },
    () => {
      closedSettled = true;
    },
  );
  gateway.remoteClose(4002);
  await gateway.waitOpens(2);
  await Promise.resolve();
  assert.equal(closedSettled, false);
});

test("unreadable envelope header after READY Resumes", async () => {
  const { clock, gateway } = await readySession();
  gateway.inbound("{");
  await gateway.waitOpens(2);
  await expectResumeOnNextSocket(clock, gateway, "wss://resume.discord.gg");
});

test("unreadable envelope header before READY Identifies after backoff", async () => {
  const { clock, gateway } = await connectingClient();
  gateway.inbound(hello(1000));
  clock.advance(1000);
  gateway.inbound(JSON.stringify({ d: null }));
  await expectIdentifyAfterBackoff(clock, gateway, 1);
});

test("catalog t with failed payload Decode does not kill the Session", async () => {
  const { gateway, client } = await readySession();
  const unknown: unknown[] = [];
  client.onUnknownDispatch((payload) => {
    unknown.push(payload);
  });
  gateway.inbound(
    JSON.stringify({
      op: 0,
      s: 2,
      t: "MESSAGE_CREATE",
      d: { not: "a message" },
    }),
  );
  assert.equal(gateway.urls.length, 1);
  assert.deepEqual(gateway.closeCodes, []);
  assert.deepEqual(unknown, [{ t: "MESSAGE_CREATE", d: { not: "a message" } }]);
});

const reconnectableCodes = [4000, 4003, 4005, 4008];
for (let i = 0; i < reconnectableCodes.length; i += 1) {
  const closeCode = reconnectableCodes[i];
  if (closeCode === undefined) {
    continue;
  }
  test(`reconnectable close ${String(closeCode)} Resumes on the resume URL`, async () => {
    const { clock, gateway } = await readySession();
    gateway.remoteClose(closeCode);
    await gateway.waitOpens(2);
    await expectResumeOnNextSocket(clock, gateway, "wss://resume.discord.gg");
  });
}

test("HTTP 401 on Get Gateway Bot rejects connect and closed and does not open a Session", async () => {
  const gateway = createMemoryGateway();
  const client = createTestClient(
    { token: "bot-token", intents: GatewayIntent.Guilds },
    {
      http: {
        request: async () => ({
          status: 401,
          headers: {},
          body: JSON.stringify({ message: "401: Unauthorized", code: 0 }),
        }),
      },
      clock: {
        nowMs: () => 0,
        schedule: () => () => {},
      },
      gateway: gateway.connect,
    },
  );
  await assert.rejects(() => client.connect(), (error: unknown) => {
    assert.ok(error instanceof DiscordHttpError);
    assert.equal(error.status, 401);
    return true;
  });
  await assert.rejects(client.closed, (error: unknown) => {
    assert.ok(error instanceof DiscordHttpError);
    assert.equal(error.status, 401);
    return true;
  });
  assert.equal(gateway.urls.length, 0);
});
