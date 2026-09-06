# Public Client experience

**Issue:** [Choose the public Client experience](https://github.com/Ermianr/moon-discord/issues/4)  
**Decision date:** 2026-09-06  
**Prototype:** branch `prototype/public-client-experience`, file `prototypes/client-experience.html`

## Question

What is the smallest comfortable public **Client** that supports REST-only, Gateway-event, HTTP-interaction, and sharded bots while hiding transport, sessions, **Bucket**s, and **Decode**?

## Answer

One **Module**. Four verbs plus constructor options. Nothing else is a product.

```ts
import { Client, GatewayIntent } from "moon-discord";

const client = new Client({
  token: process.env.DISCORD_TOKEN as string,
  intents?: number, // required only before connect()
  shards?: "recommended" | { id: number; count: number },
});

client.on("MESSAGE_CREATE", (message) => { /* decoded struct */ });
await client.rest.createMessage(channelId, { content: "pong" });
await client.connect();
await client.disconnect();

const http = await client.handleInteractionRequest({
  body: unknownPayload,
  headers: { signature: string, timestamp: string },
});
```

### Constructor

| Option | Required | Meaning |
| --- | --- | --- |
| `token` | always | Bot token. Library sets `Authorization: Bot …`. |
| `intents` | before `connect()` | Named `GatewayIntent` flags, OR’d into one number. Illegal as `1 << n` at bot sites. |
| `shards` | no | Omit: one Identify without a shard tuple unless Discord requires shards. `"recommended"`: Get Gateway Bot, own every shard in this process, honor `max_concurrency`. `{ id, count }`: Identify `shard: [id, count]` for this process. |
| `cache` | no | Omit or `false`: `client.cache` is `undefined`. `true` or a kind object: in-memory **Cache snapshot** maps after **Decode**. Not an injected adapter. Detail: [Choose the optional cache boundary](https://github.com/Ermianr/moon-discord/issues/11). |

API version is not configurable (REST `/api/v10`, Gateway `?v=10&encoding=json`).

### Lifecycle and dispatch

- `on(t, handler)` / unsubscribe function. `t` is a Discord dispatch string (`MESSAGE_CREATE`), never a camelCase alias. Payload is a **Decode**d owned struct.
- Handlers may be registered before or after `connect`. Missed events are not replayed.
- `connect()` starts Get Gateway Bot (when needed), the session machine, and shard Identifies. It is not a raw socket. Resolves when sessions are ready; reconnect/Resume inside is not a rejection.
- `disconnect()` stops heartbeats and sockets. Close `1000`/`1001` invalidation is internal.
- `connect()` without `intents` → configuration error (no socket).
- Second `connect()` on a live Client → configuration error. `connect` after `disconnect` is allowed.
- Fatal: REST/Gateway 401 (token), Gateway `4013`/`4014` (intents), `4010` (shard count). No reconnect spin. `closed` rejects; error types are [Define failure, cancellation, and backpressure semantics](https://github.com/Ermianr/moon-discord/issues/12).
- Handler throws do not tear down the session.

### Rest

`client.rest` is the typed HTTP surface. Callers never construct it.

- One method per documented operation (`createMessage`, `getGatewayBot`, `createInteractionResponse`, …). Path ids are **Snowflake** strings. Bodies are owned structs the caller builds.
- Escape hatch: `client.rest.execute({ method, path, query?, body?, auditReason? }): Promise<unknown>`. Not the happy path. Never `any`.
- REST works with no `connect` and no intents.
- **Bucket**s, User-Agent, v10 base URL, global 50 rps, 429 waits, and interaction-callback exemption from that global cap stay inside Rest.
- `application.id` on command routes is filled by the Client once known (READY or a lazy application GET), not passed by the caller on every call.

### HTTP interactions

- `handleInteractionRequest` is the inbound HTTP Interactions Endpoint URL **Seam**. The caller owns listen/bind. The library does not ship `listen({ port })` on Client (no LLVM HTTPS server in core; see ADR-0001).
- Body enters as `unknown`. Signature verify is behind the method ([Choose how HTTP Interactions signatures verify on the static tier](https://github.com/Ermianr/moon-discord/issues/15)).
- Same `on("INTERACTION_CREATE")` handlers as Gateway. Answers go through HTTP callback REST (`createInteractionResponse` / followups), never Gateway send.
- Discord: Interactions Endpoint URL and Gateway `INTERACTION_CREATE` are mutually exclusive receive modes. `connect()` plus this handle on the same application is a configuration error. REST followups remain legal.

### Sharding

Not a `ShardManager` module. One Client, one token, process-global **Bucket**s, N sessions when `shards: "recommended"`. Split hosts use `{ id, count }` with a shared `count`. Callers do not see `session_start_limit` or Identify stagger.

### What stays hidden

Session id, sequence `s`, opcodes, resume URL, heartbeat, RFC 6455, `tls`, `fetch`, zlib, ETF, **Bucket** maps, `X-RateLimit-*`, User-Agent construction, Decode of extra JSON fields, `any`, injected transports, mandatory cache, Voice protocol, user tokens. Opt-in `client.cache` is snapshots only ([Choose the optional cache boundary](https://github.com/Ermianr/moon-discord/issues/11)).

### Representative programs

**REST-only**

```ts
const client = new Client({ token });
await client.rest.createMessage(channelId, { content: "deploy note" });
```

**Gateway ping bot**

```ts
const client = new Client({
  token,
  intents: GatewayIntent.Guilds | GatewayIntent.GuildMessages | GatewayIntent.MessageContent,
});
client.on("MESSAGE_CREATE", async (message) => {
  if (message.content === "!ping") {
    await client.rest.createMessage(message.channel_id, { content: "pong" });
  }
});
await client.connect();
```

**HTTP interactions (no Gateway)**

```ts
const client = new Client({ token });
client.on("INTERACTION_CREATE", async (interaction) => {
  await client.rest.createInteractionResponse(interaction.id, interaction.token, {
    type: 4,
    data: { content: "acked" },
  });
});
// caller's HTTP server:
const response = await client.handleInteractionRequest({ body, headers });
```

**Sharded**

```ts
const client = new Client({
  token,
  intents: GatewayIntent.Guilds,
  shards: "recommended",
});
client.on("MESSAGE_CREATE", handler);
await client.connect();
```

## Why this hybrid

Compared to the four explored interfaces:

| Design | Keep | Drop |
| --- | --- | --- |
| Minimal `createClient` + `rest` + `receive` | Depth; REST without inbound | Overloading Gateway and HTTP ingest as one `receive`; construct-only handlers |
| Flexible kit | `ShardPlan` ideas as constructor options; exclusive receive modes | Public `RestHttp`, `CacheAdapter`, builder generics, `Client.rest()` as a second identity |
| Common-path `run(table)` + flattened REST | Tiny ping-bot story; docs-named REST; intent checks | Blocking `run` as the only subscribe model; 200 HTTP names on `Client`; library-owned `listen` |
| Ports on `Client` | Tests share the Client **Interface**; two I/O **Adapters** internally | `intents` required for REST-only; public Discord port |

Internal live vs simulator I/O is an **Adapter** pair for [Choose the static core architecture](https://github.com/Ermianr/moon-discord/issues/7). It is not a `ClientOptions` field.
