# Discord Gateway

Source of truth: [Gateway](https://docs.discord.com/developers/events/gateway), [Gateway events](https://docs.discord.com/developers/events/gateway-events), [opcodes and status codes](https://docs.discord.com/developers/topics/opcodes-and-status-codes).

## Envelope

Every packet:

```ts
// conceptual — decode from unknown; `d` shape depends on `op` / `t`
{ op: number, d: unknown, s: number | null, t: string | null }
```

Dispatch (`op` 0): use `t` to pick the event decoder; store the latest non-null `s` for heartbeats and Resume.

Send JSON. Query string: `v=10&encoding=json`. Optional transport compression: `compress=zlib-stream` (shared inflate context **per connection**; scriptc `zlib` is on the static Node surface). Skip `zstd-stream` until a static decoder exists. ETF is off the default path.

Outbound payload size cap: **4096 bytes**.

## Session machine

1. `GET /gateway/bot` → cache `url`.
2. WebSocket connect to cached URL + query params.
3. Hello (`10`) → wait `heartbeat_interval * jitter` (jitter in `[0, 1)`) → Heartbeat (`1`) with last `s` or `null` → then every `heartbeat_interval` ms.
4. Identify (`2`) **or** Resume (`6`) if session id + `resume_gateway_url` + `s` are valid.
5. Ready (`t: READY`) → keep `session_id`, `resume_gateway_url`, user, shard info.
6. Heartbeat ACK (`11`) after each Heartbeat. Missing ACK before the next Heartbeat → zombie: close with a code **other than** 1000/1001, reconnect, Resume.
7. Discord may send Heartbeat (`1`); reply immediately with Heartbeat.

Identify `properties`: `os`, `browser`, `device` — set `browser`/`device` to this library's name.

Identify limit: **1000 Identify / 24h** across all shards (Resume does not count). Hitting it resets the bot token. Prefer Resume. Respect `max_concurrency` (Identifies per 5 seconds); excess → Invalid Session (`9`).

Gateway send limit: **120 events per connection per 60 seconds**. Exceeding disconnects the socket.

Invalid Session (`9`): `d === true` → Resume; `d === false` → new Identify (after backoff). Reconnect (`7`) → resume flow.

Close `1000`/`1001` **invalidates** the session (bot goes offline). Other closes may leave the session resumable until timeout.

Reconnect URL: after Ready, new sockets for resume use `resume_gateway_url` with the **same** `v` and `encoding`. Fresh Identify uses the cached Get Gateway Bot `url`.

## Intents

Bitwise OR on Identify. v8+ requires the field. Empty intents means almost no dispatch events.

Privileged (must be enabled in the portal, and approved when verified): privileged message content, guild members, guild presences — confirm names/bits on the current Gateway intents table, not from memory.

`4013` invalid intents, `4014` disallowed privileged intents — configuration errors, not retry loops.

Public DX: named flags (`GatewayIntent.Guilds`) that OR into one number. Callers should not sprinkle `1 << n` at bot sites.

## Sharding

`GET /gateway/bot` recommends `shards`. Identify `shard: [id, num_shards]`. `num_shards` must stay consistent with Discord's formula or the socket closes `4010`.

Guild events arrive on one shard. REST is not sharded the same way; rate-limit buckets stay process-global unless you document otherwise.

## Voice

Voice is a **second** WebSocket + UDP path. Do not fold voice crypto and discovery into the guild Gateway module. Ship Gateway `VOICE_STATE_UPDATE` send/receive first; implement the voice server protocol only when that product slice is in scope. Docs: voice page under developers docs.
