# moon-discord

A Discord bot library whose representative programs compile on scriptc's static tier.

## Language

**Client**:
The small public module an application constructs to talk to Discord.
_Avoid_: bot object, discord.js Client, SDK

**Snowflake**:
A Discord entity identifier carried as a decimal string in JSON.
_Avoid_: number, bigint, numeric ID

**Timestamp**:
A Discord datetime carried as an ISO8601 string.
_Avoid_: Date

**Static tier**:
scriptc compilation that produces an engine-free binary without `--dynamic`, including LLVM and native C fallback.
_Avoid_: dynamic, island, treating C fallback as `--dynamic`

**Static contract**:
The published machine-readable description of how a consumer compile of a representative program stays on the static tier.
_Avoid_: treating npm `engines` or `npm install` alone as the static promise

**Decode**:
Turning Discord JSON that entered as `unknown` into library-owned structures.
_Avoid_: parse (as in flowing JSON.parse into an exact scriptc record)

**Inbound model**:
The closed library-owned structure Decode produces for a Discord resource or dispatch payload. Extra JSON keys are dropped.
_Avoid_: raw JSON object, parsed payload, sharing this type with Rest request bodies

**Outbound model**:
The closed structure a caller builds for a typed Rest body or query. Absent optional keys are omitted; JSON `null` is only for documented clears.
_Avoid_: reusing the inbound model, sending `undefined`

**Bucket**:
A Discord rate-limit class identified by response headers, not by a hard-coded route table.
_Avoid_: quota, throttle (as the named limit object)

**Rest**:
The typed HTTP surface on Client: one method per documented Discord operation.
_Avoid_: RestManager, raw execute as the happy path

**Rest hatch**:
The controlled generic HTTP call on Rest for routes that have no typed method.
_Avoid_: using it for operations Rest already names

**Dispatch**:
An inbound Discord event identified by the Gateway `t` string, carrying a decoded payload.
_Avoid_: camelCase aliases (messageCreate), library-invented event names

**Unknown dispatch**:
A Dispatch emitted after header Decode when the library cannot produce the typed inbound model: a `t` outside the official catalog, or a catalog `t` whose payload failed Decode. Observed through `onUnknownDispatch`, not through `on(t)`.
_Avoid_: dropping the event, treating unknown `t` as a session failure, calling `on(t)` with a broken payload

**Intents**:
Named Gateway Identify flags combined with bitwise OR.
_Avoid_: raw bit shifts at application sites
