---
name: discord-api
description: Implement Discord bot REST, Gateway, interactions, rate limits, and snowflake types as a high-performance scriptc-static TypeScript library. Use when building moon-discord, Discord API clients, Gateway sessions, intents, sharding, or Discord HTTP routes.
---

# Discord API (moon-discord)

Build a **bot** library: correct against [Discord's official docs](https://docs.discord.com/developers/docs), **static** under [scriptc](../scriptc/SKILL.md), deep public interface, cheap hot path.

Payload field lists, opcodes, close codes, and route shapes live on Discord's docs. This skill is the **decision surface**: invariants, seams, and compile constraints. Fetch the page for the resource you are implementing (`https://docs.discord.com/llms.txt` to discover pages).

**Pin API v10** on REST (`https://discord.com/api/v10`) and Gateway (`?v=10&encoding=json`). Never omit the version.

Bot tokens only (`Authorization: Bot <token>`). User-token / selfbot clients are out of scope.

When the compiler is the topic, read the **scriptc** skill. This skill only records Discord-shaped constraints; see [scriptc-discord.md](scriptc-discord.md).

## Product bar

Apply **static**, **hot path**, and **DX** from `AGENTS.md`.

| Pillar | Bind |
| --- | --- |
| **Static** | `scriptc coverage` on the library entry and a sample bot stays static. No npm `ws`/`undici` in core. |
| **Hot path** | Cache is opt-in, not the library's identity. Interactions HTTP can exist without a Gateway connection. |
| **DX** | Small `Client`; Gateway session, REST buckets, and decode live behind it. |

Official docs and live headers/opcodes win over folklore. Snowflakes are `string`. Payloads enter as `unknown`. No `any`.

## Workflow

Copy and track:

```
- [ ] Fetch the official page for this resource/event/opcode
- [ ] Place work in the right module (rest / gateway / decode / public client)
- [ ] Decode Discord JSON with unknown + checked casts; pick known fields
- [ ] scriptc coverage on the library entry (and a bot fixture) — static
- [ ] Honor rate limits, heartbeats, resume vs re-identify
```

Done when coverage assigns the new sites to **static**, REST/Gateway invariants below hold, and the public interface did not grow a pass-through for an internal concern.

## Module seams

Use **module / interface / seam / adapter** as in codebase-design. Suggested depth:

| Module | Callers learn | Hidden |
| --- | --- | --- |
| **Client** | token, intents, `on(event)`, REST verbs they need | session machine, buckets, sockets |
| **Rest** | route + JSON body/result types | User-Agent, `X-RateLimit-*`, 429 retry, global 50 rps |
| **Gateway** | start / stop / send (voice, presence, request members) | Hello, heartbeat+jitter, Identify/Resume, zlib |
| **Decode** | `unknown` → owned structs | extra JSON fields, snowflake strings, null vs omit |

Two HTTP adapters are legitimate: **REST** (`fetch` + TLS) and **Gateway transport** (WebSocket over `tls`). Do not import a Node `ws` package on the static path.

Public event names match Discord dispatch `t` strings (`MESSAGE_CREATE`). Typed `d` is the decoded struct, not the raw JSON object.

## Invariants (every change)

1. **IDs are strings.** JSON snowflakes must never become `number`.
2. **Open JSON.** Discord adds fields. Exact scriptc records cannot be the parse target; see [scriptc-discord.md](scriptc-discord.md).
3. **Rate limits are part of Rest.** Callers do not pass bucket state. Honor `Retry-After` / `retry_after` on 429. Cap at Discord's global 50 requests/second unless docs for that surface say otherwise (interaction callbacks are documented separately).
4. **Gateway is a state machine**, not a socket wrapper. Heartbeat ACK missing → close (not 1000/1001) → Resume. Opcode 9 + `d: false` → new session + Identify. Close `1000`/`1001` invalidates the session.
5. **Intents are mandatory** on Identify. Privileged intents without portal approval close with `4014`.
6. **User-Agent** on every REST call: `DiscordBot ($url, $versionNumber)`.
7. **Outbound Gateway payloads ≤ 4096 bytes**; encoding JSON unless a later FFI path exists for ETF.

## Branching

- **HTTP routes, auth, buckets, errors** → [rest.md](rest.md)
- **Connect, heartbeat, resume, intents, shards** → [gateway.md](gateway.md)
- **scriptc static decoding and I/O** → [scriptc-discord.md](scriptc-discord.md)

Live docs: [reference](https://docs.discord.com/developers/reference), [rate limits](https://docs.discord.com/developers/topics/rate-limits), [Gateway](https://docs.discord.com/developers/events/gateway), [Gateway events](https://docs.discord.com/developers/events/gateway-events), [opcodes and status codes](https://docs.discord.com/developers/topics/opcodes-and-status-codes), [receiving-and-responding](https://docs.discord.com/developers/interactions/receiving-and-responding).
