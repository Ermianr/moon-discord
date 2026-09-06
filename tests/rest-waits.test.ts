import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CancelledError,
  DiscordHttpError,
  HTTP_5XX_RETRY_MS,
  REST_MAX_WAIT_MS,
  SaturatedError,
  TransportError,
} from "moon-discord";
import { createTestClient } from "moon-discord/testing";
import type { Clock, RestHttp, RestHttpResponse } from "moon-discord/testing";

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

function okMessage(): RestHttpResponse {
  return {
    status: 200,
    headers: {},
    body: exampleInboundMessageJson(),
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createClientWithHttp(http: RestHttp, clock?: Clock) {
  return createTestClient(
    { token: "bot-token" },
    {
      http,
      clock: clock ?? {
        nowMs: () => 0,
        schedule: () => () => {},
      },
    },
  );
}

test("non-JSON error bodies become DiscordHttpError with code 0 and no HTML in message", async () => {
  let httpCalls = 0;
  const client = createClientWithHttp({
    request: async () => {
      httpCalls += 1;
      return {
        status: 403,
        headers: {},
        body: "<html><body>Cloudflare</body></html>",
      };
    },
  });
  await assert.rejects(
    () => client.rest.createMessage("1", { content: "hi" }),
    (error: unknown) => {
      assert.ok(error instanceof DiscordHttpError);
      assert.equal(error.status, 403);
      assert.equal(error.code, 0);
      assert.equal(error.message, "HTTP 403");
      assert.equal(error.message.includes("<"), false);
      assert.equal(error.errors, undefined);
      return true;
    },
  );
  assert.equal(httpCalls, 1);
});

test("401 JSON 50014 is DiscordHttpError and is not retried", async () => {
  let httpCalls = 0;
  const client = createClientWithHttp({
    request: async () => {
      httpCalls += 1;
      return {
        status: 401,
        headers: {},
        body: JSON.stringify({ message: "Invalid authentication", code: 50014 }),
      };
    },
  });
  await assert.rejects(
    () => client.rest.getGatewayBot(),
    (error: unknown) => {
      assert.ok(error instanceof DiscordHttpError);
      assert.equal(error.status, 401);
      assert.equal(error.code, 50014);
      assert.equal(error.message, "Invalid authentication");
      return true;
    },
  );
  assert.equal(httpCalls, 1);
});

test("Rest hatch rejects Discord JSON errors with status, code, message, and errors", async () => {
  const client = createClientWithHttp({
    request: async () => ({
      status: 400,
      headers: {},
      body: JSON.stringify({
        extra: true,
        message: "Invalid Form Body",
        code: 50035,
        errors: { content: { _errors: [{ code: "BASE_TYPE_REQUIRED", message: "This field is required" }] } },
      }),
    }),
  });
  await assert.rejects(
    () => client.rest.execute({ method: "POST", path: "/channels/1/messages" }),
    (error: unknown) => {
      assert.ok(error instanceof DiscordHttpError);
      assert.equal(error.status, 400);
      assert.equal(error.code, 50035);
      assert.equal(error.message, "Invalid Form Body");
      assert.deepEqual(error.errors, {
        content: { _errors: [{ code: "BASE_TYPE_REQUIRED", message: "This field is required" }] },
      });
      return true;
    },
  );
});

test("exported REST wait constants match the spec", () => {
  assert.equal(REST_MAX_WAIT_MS, 600_000);
  assert.equal(HTTP_5XX_RETRY_MS, 1_000);
});

test("429 including shared scope waits Retry-After then retries without surfacing 429", async () => {
  const clock = createManualClock();
  let httpCalls = 0;
  const client = createClientWithHttp(
    {
      request: async () => {
        httpCalls += 1;
        if (httpCalls === 1) {
          return {
            status: 429,
            headers: {
              "Retry-After": "2",
              "X-RateLimit-Scope": "shared",
            },
            body: JSON.stringify({ message: "You are being rate limited.", retry_after: 2, global: false }),
          };
        }
        return okMessage();
      },
    },
    clock,
  );
  const pending = client.rest.createMessage("290926798999357250", { content: "hi" });
  await flush();
  assert.equal(httpCalls, 1);
  clock.advance(1999);
  await flush();
  assert.equal(httpCalls, 1);
  clock.advance(1);
  const message = await pending;
  assert.equal(httpCalls, 2);
  assert.equal(message.id, "334385199974967042");
});

test("wait greater than REST_MAX_WAIT_MS rejects SaturatedError rest_wait with retryAfterMs", async () => {
  const clock = createManualClock();
  let httpCalls = 0;
  const client = createClientWithHttp(
    {
      request: async () => {
        httpCalls += 1;
        return {
          status: 429,
          headers: { "Retry-After": "601" },
          body: JSON.stringify({ message: "You are being rate limited.", retry_after: 601, global: false }),
        };
      },
    },
    clock,
  );
  await assert.rejects(
    () => client.rest.execute({ method: "GET", path: "/users/@me" }),
    (error: unknown) => {
      assert.ok(error instanceof SaturatedError);
      assert.equal(error.kind, "rest_wait");
      assert.equal(error.retryAfterMs, 601_000);
      return true;
    },
  );
  assert.equal(httpCalls, 1);
});

test("502 waits Retry-After then retries", async () => {
  const clock = createManualClock();
  let httpCalls = 0;
  const client = createClientWithHttp(
    {
      request: async () => {
        httpCalls += 1;
        if (httpCalls === 1) {
          return {
            status: 502,
            headers: { "Retry-After": "1" },
            body: "<html>bad gateway</html>",
          };
        }
        return okMessage();
      },
    },
    clock,
  );
  const pending = client.rest.createMessage("290926798999357250", { content: "hi" });
  await flush();
  assert.equal(httpCalls, 1);
  clock.advance(999);
  await flush();
  assert.equal(httpCalls, 1);
  clock.advance(1);
  const message = await pending;
  assert.equal(httpCalls, 2);
  assert.equal(message.content, "Supa Hot");
});

test("502 without Retry-After waits 1s plus jitter then retries", async () => {
  const clock = createManualClock();
  let httpCalls = 0;
  const client = createClientWithHttp(
    {
      request: async () => {
        httpCalls += 1;
        if (httpCalls === 1) {
          return {
            status: 502,
            headers: {},
            body: "",
          };
        }
        return okMessage();
      },
    },
    clock,
  );
  const pending = client.rest.createMessage("290926798999357250", { content: "hi" });
  await flush();
  assert.equal(httpCalls, 1);
  clock.advance(999);
  await flush();
  assert.equal(httpCalls, 1);
  clock.advance(1001);
  const message = await pending;
  assert.equal(httpCalls, 2);
  assert.equal(message.id, "334385199974967042");
});

test("other 5xx wait HTTP_5XX_RETRY_MS once then DiscordHttpError", async () => {
  const clock = createManualClock();
  let httpCalls = 0;
  const client = createClientWithHttp(
    {
      request: async () => {
        httpCalls += 1;
        return {
          status: 500,
          headers: {},
          body: JSON.stringify({ message: "Internal Server Error", code: 0 }),
        };
      },
    },
    clock,
  );
  const pending = client.rest.execute({ method: "GET", path: "/users/@me" });
  await flush();
  assert.equal(httpCalls, 1);
  clock.advance(HTTP_5XX_RETRY_MS - 1);
  await flush();
  assert.equal(httpCalls, 1);
  clock.advance(1);
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof DiscordHttpError);
    assert.equal(error.status, 500);
    return true;
  });
  assert.equal(httpCalls, 2);
});

test("bucket limiter delay greater than REST_MAX_WAIT_MS rejects SaturatedError rest_wait", async () => {
  const clock = createManualClock();
  let httpCalls = 0;
  const client = createClientWithHttp(
    {
      request: async () => {
        httpCalls += 1;
        return {
          status: 200,
          headers: {
            "X-RateLimit-Bucket": "abcd1234",
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset-After": "700",
          },
          body: exampleInboundMessageJson(),
        };
      },
    },
    clock,
  );
  await client.rest.createMessage("290926798999357250", { content: "one" });
  await assert.rejects(
    () => client.rest.createMessage("290926798999357250", { content: "two" }),
    (error: unknown) => {
      assert.ok(error instanceof SaturatedError);
      assert.equal(error.kind, "rest_wait");
      assert.equal(error.retryAfterMs, 700_000);
      return true;
    },
  );
  assert.equal(httpCalls, 1);
});

test("AbortSignal on typed Rest rejects CancelledError and does not wait", async () => {
  const clock = createManualClock();
  let httpCalls = 0;
  const client = createClientWithHttp(
    {
      request: async () => {
        httpCalls += 1;
        return {
          status: 429,
          headers: { "Retry-After": "5" },
          body: JSON.stringify({ message: "You are being rate limited.", retry_after: 5, global: false }),
        };
      },
    },
    clock,
  );
  const controller = new AbortController();
  const pending = client.rest.createMessage("290926798999357250", { content: "hi" }, { signal: controller.signal });
  await flush();
  assert.equal(httpCalls, 1);
  controller.abort();
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof CancelledError);
    return true;
  });
  clock.advance(5000);
  await flush();
  assert.equal(httpCalls, 1);
});

test("AbortSignal on Rest hatch that is already aborted rejects CancelledError without HTTP", async () => {
  let httpCalls = 0;
  const client = createClientWithHttp({
    request: async () => {
      httpCalls += 1;
      return { status: 200, headers: {}, body: "{}" };
    },
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => client.rest.execute({ method: "GET", path: "/users/@me", signal: controller.signal }),
    (error: unknown) => {
      assert.ok(error instanceof CancelledError);
      return true;
    },
  );
  assert.equal(httpCalls, 0);
});

test("native fetch abort name is wrapped as CancelledError not the raw abort error", async () => {
  const client = createClientWithHttp({
    request: async () => {
      const error = new Error("This operation was aborted");
      error.name = "AbortError";
      throw error;
    },
  });
  await assert.rejects(
    () => client.rest.getGatewayBot(),
    (error: unknown) => {
      assert.ok(error instanceof CancelledError);
      assert.equal(error.name, "CancelledError");
      return true;
    },
  );
});

test("AbortSignal rejects CancelledError while Rest is queued behind an in-flight call", async () => {
  let resolveFirst: ((response: RestHttpResponse) => void) | undefined;
  let httpCalls = 0;
  const client = createClientWithHttp({
    request: async () => {
      httpCalls += 1;
      if (httpCalls === 1) {
        return await new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return okMessage();
    },
  });
  const first = client.rest.createMessage("290926798999357250", { content: "one" });
  await flush();
  const controller = new AbortController();
  const second = client.rest.createMessage("290926798999357250", { content: "two" }, { signal: controller.signal });
  await flush();
  controller.abort();
  await assert.rejects(second, (error: unknown) => {
    assert.ok(error instanceof CancelledError);
    return true;
  });
  assert.equal(httpCalls, 1);
  if (resolveFirst === undefined) {
    throw new Error("first HTTP request did not start");
  }
  resolveFirst(okMessage());
  await first;
});

test("network failure of an HTTP attempt is TransportError", async () => {
  const client = createClientWithHttp({
    request: async () => {
      throw new Error("ECONNRESET");
    },
  });
  await assert.rejects(
    () => client.rest.createMessage("1", { content: "hi" }),
    (error: unknown) => {
      assert.ok(error instanceof TransportError);
      assert.equal(error.message, "ECONNRESET");
      return true;
    },
  );
});
