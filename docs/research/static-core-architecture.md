# Static core architecture

**Issue:** [Choose the static core architecture](https://github.com/Ermianr/moon-discord/issues/7)  
**Decision date:** 2026-09-06  
**ADR:** `docs/adr/0007-static-core-architecture.md`

## Question

Which deep modules and adapter seams should own the public **Client**, REST scheduling, Gateway session state, transport, decoding, and optional extensions while preserving a fully static compilation path?

## Answer

One public **Client**. Four internal deep modules: **Rest**, **Decode**, **Session** (JSON Gateway machine, one per **Shard**), **Gateway transport** (RFC 6455 over `tls.connect`). Three real adapter seams: Rest HTTP, Gateway connection (text JSON), and Clock. Optional **Cache** is a Client-internal collaborator (no-op vs memory), not an application-injected port. Compile lanes are separate package exports so REST-only programs never reach `tls.connect`.

This note places modules and seams. It does not reopen the public verb set ([Choose the public Client experience](https://github.com/Ermianr/moon-discord/issues/4)), Session lifecycle ([Define Gateway lifecycle and sharding semantics](https://github.com/Ermianr/moon-discord/issues/9)), or copy-**Decode** rules ([Define decoding and typed REST evolution](https://github.com/Ermianr/moon-discord/issues/8)).

## Module map

```
                    ┌─────────────────────────────────────┐
  moon-discord      │              Client                 │  public interface
  moon-discord/rest │  on / rest / connect / Gateway send │
                    └──────────┬──────────────┬───────────┘
           Rest HTTP + Clock   │              │  GatewayConn + Clock
                    ┌──────────▼──┐    ┌──────▼──────────┐
                    │    Rest     │    │    Session      │  one per owned shard
                    └──────┬──────┘    └──────┬──────────┘
                           │ Decode           │ Decode (header + payload)
                    ┌──────▼──────────────────▼──────────┐
                    │              Decode                │  in-process; no port
                    └────────────────────────────────────┘

  Gateway transport (RFC 6455 + tls.connect) implements GatewayConn.
  It is imported only by the `moon-discord` (Gateway) entry.
```

| Module | Callers learn | Hidden |
| --- | --- | --- |
| **Client** | Constructor, `on`, `onUnknownDispatch`, `rest`, `connect` / `disconnect`, `handleInteractionRequest`, five **Gateway send** methods | Wiring, application-id fill, exclusive Gateway vs HTTP ingest, shard plan, dispatch fan-in |
| **Rest** | Typed methods + **Rest hatch** | v10 URL, User-Agent, **Bucket** map, global 50 rps, interaction-callback exemption, 429 waits via Clock |
| **Decode** | `unknown` → **inbound model** or fail; outbound stringify helpers | Field copy, extra-key drop, Snowflake/Timestamp rules |
| **Session** | Start/stop over **Gateway connection** text; emit **Dispatch** / **unknown dispatch**; honor [lifecycle note](https://github.com/Ermianr/moon-discord/issues/9) | Hello/Identify/Resume, `s` / `session_id` / resume URL, heartbeat jitter/ACK, Identify stagger, close-code machine. **No TLS, frames, SHA-1, masking.** |
| **Gateway transport** | Satisfies Gateway connection | `tls.connect`, HTTP Upgrade, RFC 6455 framing/masks, size caps, `?v=10&encoding=json` with no `compress` |

**Handle interaction HTTP** is a **Client** method. Its implementation lives in the Rest compile graph (verify + **Decode** + the same `on("INTERACTION_CREATE")` path). It is not a fifth deep module. Ed25519 is [Choose how HTTP Interactions signatures verify on the static tier](https://github.com/Ermianr/moon-discord/issues/15).

**Gateway send** methods on **Client** route to the owning **Session**(s). They are not a nested `gateway` object and not an opcode hatch.

## Real adapter seams

Two adapters means a real seam. One adapter means do not invent a port.

| Seam | Production adapter | Test adapter | Used by |
| --- | --- | --- | --- |
| **Rest HTTP** | global `fetch` | scripted in-memory HTTP | **Rest** |
| **Gateway connection** | **Gateway transport** (text JSON after RFC 6455) | in-memory text pump | **Session** |
| **Clock** | `nowMs` + `schedule(ms) → cancel` over timers | manual clock | **Rest** (429, 50 rps) and **Session** (heartbeat, Identify backoff) |

**Not ports:** **Decode** (in-process copy); `node:crypto` for WS nonce/mask (local, one production path); zlib-stream (off); logger (map fog); Ed25519 (ticket 15); public I/O on `ClientOptions`. **Cache** is an internal no-op vs memory pair inside **Client**, selected by a constructor policy flag, not an injected **Adapter** ([Choose the optional cache boundary](https://github.com/Ermianr/moon-discord/issues/11)).

**Gateway transport** may keep an *internal* byte duplex for framing tests (`tls.connect` vs memory bytes). That seam is not part of **Session**’s interface.

Gateway connection (text): `sendText`, `close(code)`, inbound text, close notification. Session **Decode**s JSON. Framing tests never go through **Client**.

## Compile lanes

Reachability is the isolation mechanism. `tls.connect` / `tls.connectCb` exist in **Gateway transport** only.

| Package export | Graph | `connect()` | Static contract |
| --- | --- | --- | --- |
| `moon-discord` (`"."`) | Client + Rest + Decode + Session + Gateway transport | live | Gateway representative; default backend; only accepted C-fallback `libCall:tls.connect` / `tls.connectCb` |
| `moon-discord/rest` | Client + Rest + Decode + `handleInteractionRequest`; **no** Gateway transport, **no** `node:tls` | configuration error (no Session/transport) | REST-only representative; `--backend llvm` |
| `moon-discord/testing` | `createTestClient` + scripted Rest HTTP, text Gateway connection, manual Clock | as injected | not a coverage entry |

Same **Client** type on `"."` and `"./rest"`. Not a second product. Ping-bot / sharded samples import `moon-discord`. REST-only LLVM samples import `moon-discord/rest`. That extends [Choose the packaging and artifact contract](https://github.com/Ermianr/moon-discord/issues/6): `static-contract.json` REST entry must import `./rest`; Gateway entry must import `"."`. Do not rely on `import()` or unverified DCE to hide `tls.connect`.

`moon-discord/testing` ships in the npm tarball (factory + adapters). Repo `tests/` still stays out of the tarball.

Internal `createClient(publicOptions, ports)` wires adapters. `"."` and `"./rest"` call it with live ports. Applications never pass ports in `ClientOptions`.

## Test Client

```ts
import { createTestClient } from "moon-discord/testing";

const client = createTestClient(
  { token, intents, shards },
  { http, gateway, clock },
);
```

Tests assert through the **Client** interface (`on`, `rest`, `connect`, **Gateway send**, `handleInteractionRequest`). They do not read **Bucket** maps, sequence `s`, or frames.

## Optional extensions

No plugin bus. **Cache** attaches **inside** **Client** after successful **Decode** (typed Rest responses, **Dispatch**, and HTTP `handleInteractionRequest`). Same **inbound model**s. Constructor `cache` is a policy flag (`false` / `true` / per-kind); applications do not pass a cache **Adapter**. Default off: `client.cache` is `undefined`. Detail: [Choose the optional cache boundary](https://github.com/Ermianr/moon-discord/issues/11).

Observability stays map fog: no logging port in this architecture.

## Call flows

**REST `createMessage`:** `Client.rest` → Rest (Clock / **Bucket**) → Rest HTTP → `unknown` → **Decode** inbound (hatch skips body **Decode**).

**Gateway `MESSAGE_CREATE`:** `connect` (only on `"."`) → Get Gateway Bot via Rest → Session Identify → Gateway transport text → header **Decode** → payload **Decode** → `on(t)` or `onUnknownDispatch`.

**HTTP `handleInteractionRequest`:** caller server → **Client** (Rest graph) → verify (ticket 15) → **Decode** → `on("INTERACTION_CREATE")` → answer via Rest. No **Session**.

## Considered options

| Design | Keep | Drop |
| --- | --- | --- |
| Two modules (Rest includes Decode; Session includes RFC 6455) | Depth | Shared Decode locality; Session tests pull framing; `import()` lane split unverified |
| Ports for HTTP, TLS bytes, Clock, and crypto | Clock; test wiring | Crypto port with one adapter; TLS-byte port on Session (Session must not know frames); `./rest` as a “port” |
| Linker `import "moon-discord/gateway"` on the default Client | Isolation | Extra line on every ping-bot; fights the published Client examples |
| Public I/O on `ClientOptions` | Test injection | Contradicts the Client experience ADR |

## Explicit non-decisions

- Numeric timeouts, queue bounds, and error types ([Define failure, cancellation, and backpressure semantics](https://github.com/Ermianr/moon-discord/issues/12)).
- Heartbeat / decode / REST dispatch budgets: [Set the performance contract](https://github.com/Ermianr/moon-discord/issues/10) (`docs/research/performance-contract.md`).
- Cache interface (resolved: [Choose the optional cache boundary](https://github.com/Ermianr/moon-discord/issues/11)).
- Multipart encoding (ticket 14) and Ed25519 (ticket 15).
- CI command lists (ticket 13).
- Targets past linux x86_64 glibc; later LLVM `tls.connect` or `zlib-stream` (map fog).
