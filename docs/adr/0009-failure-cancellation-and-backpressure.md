# Throw a closed MoonDiscordError tree; Client.closed; Rest waits internally

Public operations reject with `MoonDiscordError` subclasses, not Result types or raw `fetch` values. Rest hides **Bucket**s and 429/5xx waits behind **Clock**, failing with `SaturatedError` when a single wait would exceed `REST_MAX_WAIT_MS`. The **Client** Promise `closed` fulfills on `disconnect()` and rejects on token/intent/shard (and related) fatals. Optional `AbortSignal` cancels Rest, **Gateway send**, and `connect()`; `disconnect()` cancels Gateway waits only. Dispatch handler throws stay isolated. Queue overflow rejects the newest **Gateway send**.

**Considered options:** Result unwrap on every call; caller-visible 429; unbounded waits; `onFatal`; aborting Rest on `disconnect()`; dropping the oldest Gateway opcode. Those leak machinery, hang daemons, or fight the small **Client** and scriptc’s `Error` rejection.

**Consequences:** [Choose the public Client experience](https://github.com/Ermianr/moon-discord/issues/4) gains `closed` and optional `signal` on async verbs. Discord JSON `{ code, message, errors?: unknown }` is thrown as `DiscordHttpError` (plus HTTP `status`). Numeric caps are named exports, not `ClientOptions`. Detail: `docs/research/failure-cancellation-and-backpressure.md`.
