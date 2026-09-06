# Gateway lifecycle and sharding semantics

**Issue:** [Define Gateway lifecycle and sharding semantics](https://github.com/Ermianr/moon-discord/issues/9)  
**Decision date:** 2026-09-06  
**ADR:** `docs/adr/0006-gateway-lifecycle-and-sharding.md`

## Question

What public and internal contracts should govern Gateway connection lifecycle, heartbeat acknowledgement, reconnect, resume versus re-identify, intents, sharding, outbound limits, and interaction with the **Client**?

## Answer

The **Client** owns Gateway lifecycle (`connect` / `disconnect`) and five named **Gateway send** methods. Heartbeat, Resume, Identify stagger, RFC 6455, and shard sockets stay inside a hidden **Session** per shard. Protocol facts from Discord’s Gateway docs are not reinvented; this note is the product contract around them. Encoding stays `?v=10&encoding=json` with no `compress` ([Establish the scriptc static capability baseline](https://github.com/Ermianr/moon-discord/issues/2)).

```ts
await client.connect();
await client.disconnect();

client.on("READY", (ready) => { /* inbound model */ });
client.on("RESUMED", (resumed) => { /* inbound model */ });
client.on("GUILD_MEMBERS_CHUNK", (chunk) => { /* inbound model */ });

await client.updatePresence({ since: null, activities: [], status: "online", afk: false });
await client.updateVoiceState({
  guild_id,
  channel_id, // null to leave the voice channel
  self_mute: false,
  self_deaf: false,
});
await client.requestGuildMembers({ guild_id, query: "", limit: 0, nonce });
await client.requestSoundboardSounds({ guild_ids });
await client.requestChannelInfo({ guild_id, fields: ["status", "voice_start_time"] });
```

No nested `gateway` object, no opcode hatch, no `ShardManager`, no `shardId` on `on` handlers, no heartbeat/`debug` events.

## Public Client

Constructor, `on`, `onUnknownDispatch`, `rest`, `handleInteractionRequest`, and shard options remain as in [Choose the public Client experience](https://github.com/Ermianr/moon-discord/issues/4). This ticket adds the five **Gateway send** methods above. Bodies are **outbound model**s (omit optional keys; JSON `null` only where Discord documents it, e.g. `channel_id` to leave voice, `since` when not idle).

**Intents** are constructor-only. There is no setter. Changing intents means a new **Client**. `connect()` without intents is still a configuration error. An explicit `0` is a valid Identify intents field; omitting the option is not.

`connect()`:

- Calls Get Gateway Bot (bot token). That `url` is cached for later Identify on this `connect()` lifetime. Get Gateway Bot is not cached across `disconnect()` / `connect()` (recommended shard count and `session_start_limit` change).
- Resolves when every **Session** this process owns has **Decode**d **READY** (first handshake) or **RESUMED** (if that Session’s first success was Resume). Handlers for that `t` run as part of Decode, so they may run before the Promise resolves.
- Does not wait for `GUILD_CREATE` or for Ready guilds to become available.
- Does not reject because an inner Session later reconnects or Resumes. Fatal codes below reject (or fail an already-resolved Client).
- Second `connect()` while live remains a configuration error. `connect()` after `disconnect()` is allowed and does a fresh Get Gateway Bot.

`disconnect()` stops all owned Sessions: heartbeats cancelled, sockets closed with **1000** (session invalidation is internal). REST-only Clients never call `connect`.

**READY** and **RESUMED** are ordinary **Dispatch** `t` strings. Unavailable guilds in Ready and `GUILD_DELETE` with `unavailable: true` are inbound fields only — no library-invented `guildUnavailable` events. **Cache** may keep or drop snapshots from those fields ([Choose the optional cache boundary](https://github.com/Ermianr/moon-discord/issues/11)).

## Sharding

`shards` on the constructor:

| Option | Behavior |
| --- | --- |
| omitted | Get Gateway Bot. If `shards === 1`, one Identify **without** a `shard` tuple. If `shards > 1`, configuration error **before** Identify (do not wait for 4011; do not burn Identify quota). |
| `"recommended"` | This process owns ids `0 .. N-1` where `N` is Get Gateway Bot `shards`. Every Identify includes `shard: [id, N]`, including `N === 1`. Honor `max_concurrency` buckets: `rate_limit_key = shard_id % max_concurrency`, start buckets in order, at most `max_concurrency` Identifies per 5 seconds. |
| `{ id, count }` | One Identify `shard: [id, count]`. The caller keeps `count` consistent with Discord (and with other hosts). The library does not auto-rescale or talk to other processes. |

Membership: `shard_id = (guild_id >> 22) % num_shards`. Events without `guild_id` (DMs, some subscription/entitlement payloads) arrive on shard 0. A process that does not own shard 0 does not receive them; there is no in-library IPC.

`N` and the Identify tuples are fixed until `disconnect()` + `connect()`. No live reshard. Close **4011** (sharding required) is fatal for the **Client**.

Callers never see `session_start_limit`. If `remaining === 0`, wait `reset_after` then Identify (same idea as honoring HTTP 429). Exceeding `max_concurrency` is a library bug, not an application knob.

## Session machine (hidden)

One **Session** per owned shard. Discord’s cycle holds: Hello → jittered first Heartbeat (`heartbeat_interval * jitter`, `jitter` in `[0, 1)`) → Identify or Resume → Ready; Heartbeat every interval; ACK (op 11) required before the next Heartbeat; Discord-initiated Heartbeat (op 1) answered immediately.

Zombie (no ACK between Heartbeat attempts): close with a code **other than** 1000/1001 (library uses **4000**), reconnect to `resume_gateway_url` with the same `v` and `encoding`, Resume. App-initiated `disconnect()` uses 1000/1001 and invalidates.

Resume when Discord says so: Reconnect (op 7, may arrive before Hello) — Resume **immediately**; reconnectable close; close with no code; Invalid Session (op 9) with `d === true`. Do **not** Identify on the resume URL.

New Identify (cached Get Gateway Bot `url`, not `resume_gateway_url`) when: Invalid Session `d === false`; close **4007** (invalid seq) or **4009** (session timeout); Resume too late. Identify after those uses exponential backoff: 1s, 2s, 4s, 8s, 16s, then cap **32s**, plus jitter in `[0, 1)` of the delay. Op 7 / zombie / Resume path does **not** use that backoff.

Fatal for the whole **Client** (no reconnect spin): HTTP/Gateway **401** (token), Gateway **4004**, **4010**, **4012**, **4013**, **4014**, **4011**. Reconnectable failures (including 4000, 4001, 4002, 4003, 4005, 4008, TCP drop) affect **only that Session**; other shards keep running.

Unreadable Gateway envelope header (`op` / `t`) is a protocol failure for **that Session** ([Define decoding and typed REST evolution](https://github.com/Ermianr/moon-discord/issues/8)): close ≠ 1000/1001, Resume if `session_id` exists, otherwise Identify with backoff. A catalog `t` with failed payload Decode does not kill the Session (**unknown dispatch**).

Identify payload: `token`, `intents`, `properties` (`os` from the runtime when known, else `"linux"`; `browser` and `device` = `moon-discord`), optional `shard`, and `presence` **only** when a last **Gateway send** presence exists (below). Omit `compress`, `large_threshold`, and `capabilities`.

## Gateway send

Methods may be used only after `connect()` has resolved at least once on this live Client (configuration error otherwise).

| Method | Routing |
| --- | --- |
| `updatePresence` | Every **Session** that is currently Ready. Last outbound presence is remembered and attached to later **Identify** (not Resume; not the first Identify of a brand-new `connect()` until the app calls the method). |
| `updateVoiceState` | Session for `guild_id`. Opcode 4 is guild Gateway; Voice protocol stays out of product. |
| `requestGuildMembers` | Session for `guild_id`. Resolves when the opcode is paced onto that Session. Chunks arrive as `GUILD_MEMBERS_CHUNK`. Caller owns `nonce` (≤ 32 bytes); the library does not invent one or assemble members. |
| `requestChannelInfo` | Session for `guild_id`. Result is `CHANNEL_INFO` Dispatch. |
| `requestSoundboardSounds` | Split `guild_ids` by membership formula; one opcode 31 per owned Session that has at least one id. Guilds whose shard this process does not own fail that send. Results are `SOUNDBOARD_SOUNDS` Dispatch. |

If `{ id, count }` does not own the required shard: configuration error, no Identify on a foreign tuple.

While a target Session is reconnecting: presence goes to Sessions that are Ready now; when the down Session Identifies again it carries last presence. Guild-scoped sends **wait** until that Session is Ready/Resumed, with a **bounded** wait. `disconnect()` or a fatal Client failure fails the send. The numeric timeout, queue bound, and error types are [Define failure, cancellation, and backpressure semantics](https://github.com/Ermianr/moon-discord/issues/12).

Outbound JSON **must not** exceed **4096** UTF-8 bytes: the send fails and the socket stays up (do not provoke 4002). Per connection, pace application Gateway events to Discord’s **120 / 60s**. Heartbeat, Identify, and Resume are liveness/handshake: they are not stuck behind `requestGuildMembers`. `RATE_LIMITED` remains Dispatch `t` via `on`. How a failed send is thrown is ticket 12.

## What stays hidden

Session id, sequence `s`, opcodes, `resume_gateway_url`, heartbeat timers, RFC 6455, `tls`, Identify stagger, `session_start_limit`, zlib/ETF, transport compression, `ShardManager`, injected sockets, Voice protocol, user tokens.

## Explicit non-decisions

- Error/abort/backpressure types and the numeric wait/queue caps (ticket 12).
- Module/adapter layout of Session vs transport (ticket 7).
- Optional cache of guilds after Ready (resolved: [Choose the optional cache boundary](https://github.com/Ermianr/moon-discord/issues/11)).
- Heartbeat and decode **performance** budgets: [Set the performance contract](https://github.com/Ermianr/moon-discord/issues/10) (`docs/research/performance-contract.md`).
