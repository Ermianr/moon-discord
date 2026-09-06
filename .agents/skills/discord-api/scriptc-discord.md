# scriptc × Discord

Read [scriptc/SKILL.md](../scriptc/SKILL.md) for tiers, coverage, and SC codes. This file is only the Discord-shaped constraints.

**Static** (product pillar): `--dynamic` is a last resort for a leaf tool, never for Gateway or Rest core. `scriptc coverage` on the library entry and a sample bot is the gate.

## Decode, do not struct-parse JSON

scriptc records are **exact**. Discord JSON is **open** (new fields land without a library release). Flowing `JSON.parse` into a struct type is SC2002 (or a lying shape).

Pattern:

1. `JSON.parse(text)` → `unknown` (scriptc's parse type).
2. Narrow with `typeof` / property checks.
3. Checked cast (`as Envelope`) only after the value matches, or a small decoder that **copies known fields** into an owned struct.

Owned structs are closed and scriptc-friendly. Raw payloads are not.

`any` is SC2011 without `--dynamic`. Event `d` in public types is a specific struct or a discriminated union, never `any`.

Unions: narrow on `op` or `t` **before** reading arm-specific fields (`d.heartbeat_interval` only after `op === 10`).

## IDs, numbers, maps

Snowflakes stay `string`. JS numbers are f64; a uint64 id does not fit.

`Map`/`Set` keys: strings and numbers only. Cache maps keyed by snowflake string.

Dense arrays: no holes, no `undefined` elements. Optional Discord arrays: check `.length`; do not `arr[i]` blindly. `pop()` on empty **traps**.

## I/O that stays static

| Need | Static direction |
| --- | --- |
| REST | `fetch` (use `Response.bytes()` if `arrayBuffer()` is SC2020) |
| Gateway socket | WebSocket framing over `tls` / `net` in-tree, or outbound FFI to a C stack ([scriptc ffi](../scriptc/ffi.md)) — executable builds only |
| Inflate zlib-stream | Node `zlib` surface listed in the scriptc skill |
| Heartbeats | timers |
| Token / files | `process` / `fs` with explicit `argv.length` checks |

npm `ws`, `discord.js`, `undici` as a dependency: coverage will mark **island** (SC2013) unless `--dynamic`. That is a product regression for this library.

`JSON.stringify` field order follows **declaration order** of the record, not insertion order. Build Identify/REST bodies as declared structs.

Call stdlib functions directly (`Math.floor(x)`), not `const g = Math.floor`.

## Tests vs bots

Unit-test decode and the session machine with **fixture JSON** (`unknown` in, structs out). Do not require a live Discord token for the default test run.

Live Gateway tests are opt-in and must not Identify in a tight loop (1000/day token reset).
