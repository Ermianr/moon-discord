import { randomBytes } from "node:crypto";
import { CancelledError, DiscordHttpError, HTTP_5XX_RETRY_MS, REST_MAX_WAIT_MS, SaturatedError, TransportError } from "../errors.js";
import type { Clock, RestHttp, RestHttpRequest, RestHttpResponse } from "../ports.js";
import { headerValue, mapHttpAdapterError, retryAfterMs, toDiscordHttpError } from "./http-error.js";

type BucketState = {
  remaining: number;
  resetAtMs: number;
};

type HashEntry = {
  route: string;
  hash: string;
};

type BucketEntry = {
  key: string;
  state: BucketState;
};

const GLOBAL_RPS = 50;
const GLOBAL_WINDOW_MS = 1000;

export function rateLimitedHttp(
  http: RestHttp,
  clock: Clock,
  tokenDeath?: { dead: boolean; error: DiscordHttpError },
): RestHttp {
  const hashes: HashEntry[] = [];
  const buckets: BucketEntry[] = [];
  const globalSends: number[] = [];
  let dispatchQueue: Promise<void> = Promise.resolve();

  const request = (httpRequest: RestHttpRequest): Promise<RestHttpResponse> => {
    const work = (async (): Promise<RestHttpResponse> => {
      try {
        await dispatchQueue;
      } catch {
        // Previous dispatch failed; this request still takes its turn.
      }
      return sendWhenReady(http, clock, hashes, buckets, globalSends, httpRequest, tokenDeath);
    })();
    dispatchQueue = (async (): Promise<void> => {
      try {
        await work;
      } catch {
        // Keep the serial queue moving after a failed attempt.
      }
    })();
    return abortableRequest(work, httpRequest.signal);
  };

  return { request };
}

async function sendWhenReady(
  http: RestHttp,
  clock: Clock,
  hashes: HashEntry[],
  buckets: BucketEntry[],
  globalSends: number[],
  httpRequest: RestHttpRequest,
  tokenDeath?: { dead: boolean; error: DiscordHttpError },
): Promise<RestHttpResponse> {
  let other5xxRetried = false;
  let retryBackoffMs = 1000;
  const signal = httpRequest.signal;
  for (;;) {
    if (tokenDeath !== undefined && tokenDeath.dead) {
      throw tokenDeath.error;
    }
    throwIfAborted(signal);
    const route = routeKey(httpRequest.method, httpRequest.url);
    const major = majorResource(httpRequest.url);
    const hash = findHash(hashes, route);
    if (hash !== undefined) {
      const bucket = findBucket(buckets, `${hash}:${major}`);
      if (bucket !== undefined && bucket.remaining === 0) {
        const delayMs = bucket.resetAtMs - clock.nowMs();
        if (delayMs > 0) {
          await wait(clock, delayMs, signal);
        }
      }
    }
    await waitForGlobalSlot(clock, globalSends, signal, httpRequest);
    let response: RestHttpResponse;
    try {
      response = await http.request(httpRequest);
    } catch (error: unknown) {
      mapHttpAdapterError(error);
    }
    rememberHeaders(hashes, buckets, clock, route, major, response.headers);
    if (response.status >= 200 && response.status < 300) {
      return response;
    }
    if (response.status === 429) {
      const delayMs = retryAfterMs(response);
      await wait(clock, delayMs === undefined ? 1000 : delayMs, signal);
      continue;
    }
    if (response.status === 502 || response.status === 503 || response.status === 504) {
      const headerDelay = retryAfterMs(response);
      if (headerDelay === undefined) {
        const delayMs = retryBackoffMs + jitterPortion(retryBackoffMs);
        retryBackoffMs = retryBackoffMs * 2;
        if (retryBackoffMs > 32_000) {
          retryBackoffMs = 32_000;
        }
        await wait(clock, delayMs, signal);
      } else {
        await wait(clock, headerDelay, signal);
      }
      continue;
    }
    if (response.status >= 500 && response.status < 600 && !other5xxRetried) {
      other5xxRetried = true;
      await wait(clock, HTTP_5XX_RETRY_MS, signal);
      continue;
    }
    throw toDiscordHttpError(response);
  }
}

async function waitForGlobalSlot(
  clock: Clock,
  globalSends: number[],
  signal: AbortSignal | undefined,
  httpRequest: RestHttpRequest,
): Promise<void> {
  if ("skipGlobalRateLimit" in httpRequest && httpRequest.skipGlobalRateLimit === true) {
    return;
  }
  for (;;) {
    throwIfAborted(signal);
    const now = clock.nowMs();
    pruneGlobalSends(globalSends, now);
    if (globalSends.length < GLOBAL_RPS) {
      globalSends.push(now);
      return;
    }
    const oldest = globalSends[0];
    if (oldest === undefined) {
      globalSends.push(now);
      return;
    }
    const delayMs = oldest + GLOBAL_WINDOW_MS - now;
    if (delayMs <= 0) {
      pruneGlobalSends(globalSends, now);
      globalSends.push(now);
      return;
    }
    await wait(clock, delayMs, signal);
  }
}

function pruneGlobalSends(globalSends: number[], now: number): void {
  while (globalSends.length > 0) {
    const oldest = globalSends[0];
    if (oldest === undefined || now - oldest >= GLOBAL_WINDOW_MS) {
      globalSends.shift();
    } else {
      return;
    }
  }
}

function rememberHeaders(
  hashes: HashEntry[],
  buckets: BucketEntry[],
  clock: Clock,
  route: string,
  major: string,
  headers: Record<string, string>,
): void {
  const hash = headerValue(headers, "x-ratelimit-bucket");
  if (hash === undefined || hash === "") {
    return;
  }
  setHash(hashes, route, hash);
  const remainingText = headerValue(headers, "x-ratelimit-remaining");
  if (remainingText === undefined) {
    return;
  }
  const remaining = Number(remainingText);
  const resetAfterText = headerValue(headers, "x-ratelimit-reset-after");
  let resetAtMs = clock.nowMs();
  if (resetAfterText !== undefined) {
    resetAtMs = clock.nowMs() + Math.ceil(Number(resetAfterText) * 1000);
  } else {
    const resetText = headerValue(headers, "x-ratelimit-reset");
    if (resetText !== undefined) {
      resetAtMs = Math.ceil(Number(resetText) * 1000);
    }
  }
  setBucket(buckets, `${hash}:${major}`, { remaining, resetAtMs });
}

function wait(clock: Clock, delayMs: number, signal: AbortSignal | undefined): Promise<void> {
  throwIfAborted(signal);
  if (delayMs > REST_MAX_WAIT_MS) {
    return Promise.reject(new SaturatedError({ kind: "rest_wait", retryAfterMs: delayMs }));
  }
  if (delayMs <= 0) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const cancelTimer = clock.schedule(delayMs, () => {
      if (signal !== undefined) {
        signal.removeEventListener("abort", onAbort);
      }
      resolve();
    });
    const onAbort = () => {
      cancelTimer();
      reject(new CancelledError());
    };
    if (signal !== undefined) {
      signal.addEventListener("abort", onAbort);
    }
  });
}

function abortableRequest(
  work: Promise<RestHttpResponse>,
  signal: AbortSignal | undefined,
): Promise<RestHttpResponse> {
  if (signal === undefined) {
    return work;
  }
  if (signal.aborted) {
    return Promise.reject(new CancelledError());
  }
  return new Promise<RestHttpResponse>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (!settled) {
        settled = true;
        reject(new CancelledError());
      }
    };
    signal.addEventListener("abort", onAbort);
    void (async () => {
      try {
        const response = await work;
        if (!settled) {
          settled = true;
          signal.removeEventListener("abort", onAbort);
          resolve(response);
        }
      } catch (error: unknown) {
        if (!settled) {
          settled = true;
          signal.removeEventListener("abort", onAbort);
          reject(error instanceof Error ? error : new TransportError());
        }
      }
    })();
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal !== undefined && signal.aborted) {
    throw new CancelledError();
  }
}

function jitterPortion(delayMs: number): number {
  const bytes = randomBytes(1);
  const value = bytes[0];
  if (value === undefined) {
    return 0;
  }
  return Math.floor((value / 256) * delayMs);
}

function routeKey(method: string, url: string): string {
  const parsed = new URL(url);
  return `${method}:${parsed.pathname}`;
}

function majorResource(url: string): string {
  const parsed = new URL(url);
  const parts = parsed.pathname.split("/");
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (part === "channels" || part === "guilds") {
      const id = parts[i + 1];
      if (id !== undefined && id !== "") {
        return `${part}:${id}`;
      }
    }
    if (part === "webhooks") {
      const id = parts[i + 1];
      const token = parts[i + 2];
      if (id !== undefined && id !== "") {
        if (token !== undefined && token !== "" && token !== "token") {
          return `webhooks:${id}:${token}`;
        }
        return `webhooks:${id}`;
      }
    }
  }
  return "";
}

function findHash(hashes: HashEntry[], route: string): string | undefined {
  for (let i = 0; i < hashes.length; i += 1) {
    const entry = hashes[i];
    if (entry !== undefined && entry.route === route) {
      return entry.hash;
    }
  }
  return undefined;
}

function setHash(hashes: HashEntry[], route: string, hash: string): void {
  for (let i = 0; i < hashes.length; i += 1) {
    const entry = hashes[i];
    if (entry !== undefined && entry.route === route) {
      entry.hash = hash;
      return;
    }
  }
  hashes.push({ route, hash });
}

function findBucket(buckets: BucketEntry[], key: string): BucketState | undefined {
  for (let i = 0; i < buckets.length; i += 1) {
    const entry = buckets[i];
    if (entry !== undefined && entry.key === key) {
      return entry.state;
    }
  }
  return undefined;
}

function setBucket(buckets: BucketEntry[], key: string, state: BucketState): void {
  for (let i = 0; i < buckets.length; i += 1) {
    const entry = buckets[i];
    if (entry !== undefined && entry.key === key) {
      entry.state = state;
      return;
    }
  }
  buckets.push({ key, state });
}
