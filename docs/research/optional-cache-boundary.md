# Optional cache boundary

**Issue:** [Choose the optional cache boundary](https://github.com/Ermianr/moon-discord/issues/11)  
**Decision date:** 2026-09-06  
**ADR:** `docs/adr/0009-optional-cache-boundary.md`  
**Prototype:** branch `prototype/optional-cache-boundary`, file `prototypes/optional-cache-boundary.html`

## Question

What optional cache interface provides useful identity and lookup behavior without coupling **Client**, Gateway **Decode**, interactions, or **Rest** to a mandatory in-memory Discord model?

## Answer

Cache is an optional **Client** collaborator, off by default. After a successful **Decode** (typed **Rest** or **Dispatch**, including HTTP `handleInteractionRequest`), the **Client** may store **inbound model** snapshots keyed by **Snowflake**. Lookup returns that last snapshot or `undefined`. It never auto-fetches, never wraps resources in classes with methods, and is not imported by **Decode**, **Rest**, **Session**, or Gateway transport.

`client.cache` is `undefined` unless the constructor opts in. Applications read snapshots; they do not inject a cache **Adapter**. Internal adapters are no-op versus in-memory maps only.

```ts
const client = new Client({
  token,
  intents,
  cache: true, // or { messages: { maxPerChannel: 50 } }
});

client.on("MESSAGE_CREATE", (message) => {
  const guild = client.cache?.guild(message.guild_id);
});

client.cache?.user(id); // User inbound snapshot | undefined
```

### Constructor

| Option | Default | Meaning |
| --- | --- | --- |
| omit / `cache: false` | **off** | `client.cache` is `undefined`. No maps. REST-only and ping bots unchanged. |
| `cache: true` | memory | Guild, user, channel, and member snapshots on. Message snapshots off. |
| `cache: { … }` | memory | Same maps; per-kind flags below. |

| Kind flag | Default when cache is on | Notes |
| --- | --- | --- |
| `guilds` | on | Get Guild / available `GUILD_CREATE` shape. |
| `users` | on | User resource inbound. Nested partial authors do not invent a User if **Decode** did not produce that inbound. |
| `channels` | on | Includes threads as channels. Nested arrays on `GUILD_CREATE` populate this map. |
| `members` | on | Key is `(guild_id, user_id)`. Chunks from `requestGuildMembers` may fill it. |
| `messages` | **off** | Opt in with `{ maxPerChannel: number }` (dense, bounded, oldest dropped). Unbounded message maps are not offered. |

Policy is constructor-only (same as **Intents**). There is no `enableCache()` and no setter. Changing policy means a new **Client**.

Presence, voice states, and emoji/role tables are not separate maps. Roles and emojis live on the guild snapshot when that inbound includes them.

### Lookup interface

```ts
type Cache = {
  guild(id: Snowflake): GuildSnapshot | undefined;
  user(id: Snowflake): UserSnapshot | undefined;
  channel(id: Snowflake): ChannelSnapshot | undefined;
  member(guildId: Snowflake, userId: Snowflake): MemberSnapshot | undefined;
  message(channelId: Snowflake, messageId: Snowflake): MessageSnapshot | undefined;
};
```

Snapshot types are the **inbound model**s for the corresponding REST GET / full Gateway create payload, not event-specific leftovers and not classes. No `client.guilds`, no Collection, no `.send()` / `.reply()` on a cached value.

A miss is `undefined`. Lookup does not call **Rest**, does not Identify, and does not throw.

### Write rules (hidden)

The **Client** calls the collaborator only after **Decode** succeeds:

| Source | Writes cache? |
| --- | --- |
| Typed **Rest** success body | Yes, for kinds the policy enables |
| **Dispatch** `on(t)` payload | Yes, using that event’s inbound (full replace or patch) |
| `handleInteractionRequest` after **Decode** | Yes, from nested inbound fields that are those snapshot types |
| **Rest hatch** (`unknown`) | No |
| **Unknown dispatch** | No |
| Failed payload **Decode** | No |

**Replace** when **Decode** produced a full snapshot type (available `GUILD_CREATE`, GET, `GUILD_MEMBER_ADD` member, …). **Patch** copies present fields onto an existing snapshot of that id. **Patch with no prior snapshot is ignored** — the cache does not synthesize a kitchen-sink resource from a partial update.

`GUILD_DELETE` with `unavailable: true` patches `unavailable` and keeps the guild. `GUILD_DELETE` that removes the guild drops that guild snapshot and nested channel/member snapshots for it. `disconnect()` does not clear maps: cache is process memory on this **Client**, not **Session** state. A new **Client** starts empty.

One **Client** has one cache for every owned **Shard**. No per-shard maps.

### What stays uncoupled

- **Decode** still only turns `unknown` into inbound/outbound models. It does not know maps exist.
- **Rest** still only schedules HTTP. It does not read cache on the way out or GET on behalf of a miss.
- **Session** / Gateway transport still only run the JSON machine. Resume does not replay cache.
- **Interaction signature** verify does not touch cache. Remember happens on the **Client** after **Decode**, on the same path as Gateway `INTERACTION_CREATE`.
- `createTestClient` does not grow a cache **Adapter**. Tests opt in with the same constructor flag and assert through `client.cache` and `on`.

Internal no-op versus memory is a real **Adapter** pair *inside* **Client**. Applications never pass those adapters in `ClientOptions`. Redis, SQLite, and shared-process caches are not a 1.0 interface; an application that wants them listens on `on` / wraps **Rest** itself.

### 1.0 placement

Optional cache is part of the public **Client** contract by `1.0`, default off. It is not a gate on the four `0.x` cuts in [Define 1.0 completeness and pre-1.0 milestones](https://github.com/Ermianr/moon-discord/issues/5). Implementation belongs with inbound models (usable guild-bot and later). REST-only with cache off remains a supported mode.

## Why this hybrid

| Design | Keep | Drop |
| --- | --- | --- |
| discord.js-style managers / Collections / entity classes | Familiar lookup by snowflake | Mandatory identity; `.reply()` on cache; kitchen-sink types ticket 8 forbade; every bot pays | 
| Public `CacheAdapter` on `ClientOptions` | Redis later | Contradicts [Choose the static core architecture](https://github.com/Ermianr/moon-discord/issues/7) (apps do not pass ports); static-tier I/O for Redis is a new product |
| External observer (`cache.observe(client)`) | **Client** stays unaware | Typed **Rest** and HTTP ingest would not write unless **Client** still notifies; two objects to wire; DX fights one-Client |
| Auto-fetch on miss | Fewer explicit GETs | Couples **Rest** to cache; lookup becomes latency/rate-limit; ping bot is no longer a lookup-free path |
| Always-present empty `client.cache` | Simpler optional chaining | Implies a store when the product promise is “off” |

## Explicit non-decisions

- Numeric `maxPerChannel` defaults and eviction timing ([Set the performance contract](https://github.com/Ermianr/moon-discord/issues/10) may budget decode vs remember).
- Failure if a snapshot field patch disagrees with **Decode** types ([Define failure, cancellation, and backpressure semantics](https://github.com/Ermianr/moon-discord/issues/12)).
- Whether a later scriptc-friendly durable store becomes a second *application-visible* adapter (map fog / post-1.0).
