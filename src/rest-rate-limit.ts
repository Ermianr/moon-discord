import type { Clock, RestHttp, RestHttpRequest, RestHttpResponse } from "./ports.js";

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

export function rateLimitedHttp(http: RestHttp, clock: Clock): RestHttp {
  const hashes: HashEntry[] = [];
  const buckets: BucketEntry[] = [];
  const globalSends: number[] = [];
  let dispatchQueue: Promise<void> = Promise.resolve();

  const request = (httpRequest: RestHttpRequest): Promise<RestHttpResponse> => {
    const result: Promise<RestHttpResponse> = dispatchQueue.then(
      () => sendWhenReady(http, clock, hashes, buckets, globalSends, httpRequest),
      () => sendWhenReady(http, clock, hashes, buckets, globalSends, httpRequest),
    );
    dispatchQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
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
): Promise<RestHttpResponse> {
  const route = routeKey(httpRequest.method, httpRequest.url);
  const major = majorResource(httpRequest.url);
  const hash = findHash(hashes, route);
  if (hash !== undefined) {
    const bucket = findBucket(buckets, `${hash}:${major}`);
    if (bucket !== undefined && bucket.remaining === 0) {
      const delayMs = bucket.resetAtMs - clock.nowMs();
      if (delayMs > 0) {
        await wait(clock, delayMs);
      }
    }
  }
  await waitForGlobalSlot(clock, globalSends);
  const response = await http.request(httpRequest);
  rememberHeaders(hashes, buckets, clock, route, major, response.headers);
  return response;
}

async function waitForGlobalSlot(clock: Clock, globalSends: number[]): Promise<void> {
  for (;;) {
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
    await wait(clock, delayMs);
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

function wait(clock: Clock, delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    clock.schedule(delayMs, () => {
      resolve();
    });
  });
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

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const keys = Object.keys(headers);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (key !== undefined && key.toLowerCase() === name) {
      return headers[key];
    }
  }
  return undefined;
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
