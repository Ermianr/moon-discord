# Failure, cancellation, and backpressure

**Issue:** [Define failure, cancellation, and backpressure semantics](https://github.com/Ermianr/moon-discord/issues/12)  
**Decision date:** 2026-09-06  
**ADR:** `docs/adr/0009-failure-cancellation-and-backpressure.md`

## Question

How should public operations represent Discord errors, rate-limit exhaustion, transport failure, cancellation, queue pressure, malformed payloads, and session termination without leaking internal machinery?

## Answer

Public async operations **throw** subclasses of `MoonDiscordError` (scriptc pins Promise rejection to `Error`; no Result unwrap on the happy path). Rest **honors** Discord waits internally (**Bucket**, global 50 rps, 429, documented 5xx retries) and never hands the caller a `Response`, rate-limit header, or **Bucket** id. The **Client** exposes `closed`: pending at construct, fulfills on `disconnect()`, rejects on a fatal Client failure. Optional `AbortSignal` on Rest methods, the **Rest hatch**, **Gateway send**, and `connect()` is the per-call cancel; `disconnect()` cancels Gateway waits only.

This note is the product error contract. It does not reopen Session reconnect ([Define Gateway lifecycle and sharding semantics](https://github.com/Ermianr/moon-discord/issues/9)), copy-**Decode** ([Define decoding and typed REST evolution](https://github.com/Ermianr/moon-discord/issues/8)), or adapter seams ([Choose the static core architecture](https://github.com/Ermianr/moon-discord/issues/7)).

## Delivery

| Operation | Failure |
| --- | --- |
| Typed Rest / hatch | Promise rejects with `MoonDiscordError` |
| `connect()` | Rejects on fatal, `CancelledError`, or Rest failure of Get Gateway Bot; stays pending across reconnectable Session failures until **READY**/**RESUMED** |
| **Gateway send** | Rejects with the types below; does not close the socket for oversized JSON |
| `handleInteractionRequest` | Rejects `DecodeError` when the body cannot become an inbound model; does not call `on("INTERACTION_CREATE")` |
| Configuration misuse | `ConfigurationError`, synchronously when no I/O is required |

`createTestClient` uses the same classes. `error.name` is the class name.

## Type tree

Named exports from `moon-discord` and `moon-discord/rest`:

```ts
class MoonDiscordError extends Error {}

class ConfigurationError extends MoonDiscordError {}

class DiscordHttpError extends MoonDiscordError {
  status: number;
  code: number; // Discord JSON `code`, or 0 when the body is not Discord JSON
  message: string;
  errors?: unknown;
}

class DecodeError extends MoonDiscordError {}

class CancelledError extends MoonDiscordError {}

class SaturatedError extends MoonDiscordError {
  kind: "rest_wait" | "gateway_queue" | "gateway_session_wait";
  retryAfterMs?: number; // known delay that was not waited, when applicable
}

class TransportError extends MoonDiscordError {}

class GatewayFatalError extends MoonDiscordError {
  closeCode: number;
}
```

No `Response`, `Headers`, or **Bucket** fields. Native `fetch` abort is wrapped as `CancelledError` so callers do not depend on `DOMException`.

## Rest

- **429** (including `X-RateLimit-Scope: shared`): wait `Retry-After` / `retry_after` via **Clock**, then retry. The caller never sees a pacing 429. Shared 429s are not invalid-request counts (Discord).
- If that delay, or the delay until this request may be sent under the global 50 rps / **Bucket** limiter, is **greater than** `REST_MAX_WAIT_MS` (**600_000**): do not wait; `SaturatedError` with `kind: "rest_wait"` and `retryAfterMs` when known. No Rest waiter-count cap.
- **401** (and JSON `50014` when present): do not retry. REST-only: that Promise rejects `DiscordHttpError`. If any **Session** exists: fatal for the **Client** (stop Sessions, reject `closed` with that `DiscordHttpError`).
- **403**: `DiscordHttpError`; not fatal; not retried.
- Other **4xx** except 429: `DiscordHttpError`; not retried.
- **502/503/504**: retry with **Clock**. `Retry-After` / `retry_after` wins when present; otherwise 1s, 2s, 4s, 8s, 16s, cap **32s**, plus jitter in `[0, 1)` of the delay (same shape as Identify backoff). Each sleep still subject to `REST_MAX_WAIT_MS`.
- **Other 5xx**: wait `HTTP_5XX_RETRY_MS` (**1_000**), one retry; then `DiscordHttpError`.
- Non-JSON error body (Cloudflare HTML): `DiscordHttpError` with `status`, `code: 0`, `message` like `HTTP ${status}` (no HTML). Non-JSON 429: wait `Retry-After` if present; otherwise the 1s path, still capped.
- Typed success body that fails **Decode**: `DecodeError` (not `DiscordHttpError`). Hatch success stays `unknown` and does not Decode.
- Network/TLS failure of that HTTP attempt: `TransportError`. Not retried as 5xx. Get Gateway Bot is Rest: `TransportError` rejects `connect()`.
- Interaction callback/followup routes stay exempt from the global 50 rps cap; they still honor per-route 429 waits.
- Multipart encode (missing filename/`bytes`, required form file absent, boundary exhausted) throws `ConfigurationError` before HTTP. Discord size rejects stay `DiscordHttpError`. Layout: [Choose a static-tier encoding for Discord multipart REST](https://github.com/Ermianr/moon-discord/issues/14).

## Gateway and `closed`

- `closed` is pending at construct. `disconnect()` fulfills it (idempotent, including REST-only). A REST script need not await it.
- Fatal rejects `closed`. The first fatal wins. In-flight **Gateway send** and a pending `connect()` reject with that fatal error (`GatewayFatalError` or `DiscordHttpError` for token 401).
- `disconnect()` rejects pending `connect()` and waiting **Gateway send**s with `CancelledError`. It does **not** abort in-flight Rest. Rest remains legal after `disconnect()` and after a **non-token** Gateway fatal (intents/shard/version). After token 401/4004, further Rest is `DiscordHttpError` without retry. Further `connect()` / **Gateway send** after fatal throw `GatewayFatalError` (or the token `DiscordHttpError`).
- `connect()` has no library time cap. It stays pending across reconnectable Session failures until **READY**/**RESUMED**, abort, or fatal. Bound it with `AbortSignal`.
- Reconnectable transport drops stay inside **Session**; they are not `TransportError` on `on` handlers.
- Guild-scoped **Gateway send** while that Session is not Ready/Resumed waits up to `GATEWAY_SESSION_WAIT_MS` (**60_000**), then `SaturatedError` `kind: "gateway_session_wait"`. Presence goes only to Sessions already Ready.
- Application opcodes queued per Session: `GATEWAY_SEND_QUEUE` (**120**). The 121st send is `SaturatedError` `kind: "gateway_queue"` (reject newest; do not drop a send whose Promise the caller already holds). Pacing 120/60s waits inside that queue. Heartbeat, Identify, and Resume are not queued behind application sends.
- Outbound JSON **> 4096** UTF-8 bytes: `ConfigurationError`; socket stays up.
- `RATE_LIMITED` remains `on("RATE_LIMITED")`, not a throw.
- Dispatch handler throws (sync or rejected Promise) are isolated: no teardown, no `closed`, no library event. Handlers that care catch themselves.

## Cancellation

```ts
await client.rest.createMessage(channelId, body, { signal });
await client.connect({ signal });
await client.updatePresence(presence, { signal });
```

No constructor `signal`. Abort → `CancelledError`. Abort does not undo work Discord already applied.

## Configuration

`ConfigurationError` (not `DiscordHttpError`): missing intents, second `connect()` while live, **Gateway send** before `connect()` has resolved, shard this process does not own, Gateway + HTTP ingest on the same application, `connect()` / **Gateway send** on `moon-discord/rest`, oversized Gateway JSON, and the same class of misuse already named in the Client and Gateway notes.

## Exported constants

Not `ClientOptions`:

| Export | Value |
| --- | --- |
| `REST_MAX_WAIT_MS` | `600_000` |
| `HTTP_5XX_RETRY_MS` | `1_000` |
| `GATEWAY_SEND_QUEUE` | `120` |
| `GATEWAY_SESSION_WAIT_MS` | `60_000` |

Tests advance **Clock**; they do not invent a second error module.

## HTTP interactions

Ed25519 failure is [Choose how HTTP Interactions signatures verify on the static tier](https://github.com/Ermianr/moon-discord/issues/15). A well-formed PING still returns the success response for the caller’s server to write. A body that fails **Decode** rejects `handleInteractionRequest` with `DecodeError`; mapping that to an HTTP status is the caller’s server.

## What stays hidden

**Bucket** maps, `X-RateLimit-*`, `retry_after` except `SaturatedError.retryAfterMs` when a wait was refused, `session_start_limit`, resume URL, sequence `s`, RFC 6455, `fetch` `Response`, Cloudflare HTML, handler exception text, debug events.

## Considered options

| Design | Keep | Drop |
| --- | --- | --- |
| Result `{ ok, error }` on every Rest call | Exhaustive typing | Fights scriptc `Error` rejection and the four-line ping bot |
| Surface 429 / buckets to the caller | Honesty about Discord | Invalid-request bans; leaks Rest internals |
| Unbounded 429 wait | Never fail a legal retry | Pathological `retry_after` hangs a Promise |
| Library `onFatal` / debug events | Daemon visibility | Contradicts the Client event rule (`t` strings only) |
| Abort in-flight Rest on `disconnect()` | Symmetric cancel | Rest is valid without Gateway |
| Drop oldest Gateway send on overflow | Keep newest | Caller already holds the dropped Promise |
| Extra `connect()` wall-clock cap | Bound daemons | `AbortSignal` is that bound; Identify backoff is Discord’s |

## Explicit non-decisions

- Ed25519 failure shape ([Choose how HTTP Interactions signatures verify on the static tier](https://github.com/Ermianr/moon-discord/issues/15)).
- Logging / diagnostics (map fog).
- Observability of isolated handler throws (no logger port).
