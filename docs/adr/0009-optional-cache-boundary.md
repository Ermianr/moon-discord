# Optional cache is Client-owned inbound snapshots, off by default

Applications that want identity lookup opt in on the **Client** constructor. After successful **Decode**, the **Client** stores **inbound model** snapshots by **Snowflake** (member: guild + user). `client.cache` is `undefined` when cache is off. Lookup never auto-fetches, never produces entity classes, and is not a port applications inject. **Decode**, **Rest**, and **Session** do not import the maps.

**Considered options:** discord.js managers and live Guild/Message classes; a public cache **Adapter** on `ClientOptions`; a subscriber that observes the **Client** from outside; GET-on-miss. Those either make cache the library’s identity, leak I/O into every bot, miss typed **Rest** / HTTP ingest writes, or couple lookup to **Bucket**s.

**Consequences:** REST-only and ping bots stay cache-free. Message snapshots are opt-in and bounded. `disconnect()` keeps maps; a new **Client** does not. Internal no-op versus memory is hidden. Detail: `docs/research/optional-cache-boundary.md`.
