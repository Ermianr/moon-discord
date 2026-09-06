# Decoding and typed REST evolution

**Issue:** [Define decoding and typed REST evolution](https://github.com/Ermianr/moon-discord/issues/8)  
**Decision date:** 2026-09-06  
**ADR:** `docs/adr/0005-decoding-and-typed-rest-evolution.md`

## Question

How should the library own and evolve Discord payload models, typed REST operations, open JSON decoding, snowflakes, nullability, and the generic route escape hatch without introducing `any` or exact-record failures?

## Answer

Hand-written closed structs and copy-**Decode** against official Discord docs. **Inbound model** and **outbound model** are distinct. Extra inbound JSON is dropped. Typed **Rest** methods fail when Decode fails. The **Rest hatch** does not Decode success bodies. **Unknown dispatch** covers unknown `t` and failed payload Decode for a catalog `t`.

## Ownership

- Source of truth for shapes: official Discord documentation and observed payloads/headers, not community OpenAPI.
- Authors write inbound/outbound structs and the copy-Decode that fills them. `JSON.parse` / `Response.json` stay `unknown`. Checked casts, if used, are only for a minimal Gateway/HTTP header, never as the way a resource becomes an inbound model. The owned struct is always a field-by-field copy.
- Public **Rest** is the TypeScript method list plus those types. An internal operations table may later generate method names; it is not a 1.0 blocker and is not a parse DSL.
- `any` is forbidden in production. Exact scriptc records are not parse targets (SC2002 / open JSON).

## Inbound vs outbound

- **Inbound model:** Decode output for Rest GET/list responses and **Dispatch** payloads. Extra keys dropped. Documented required fields are required. One inbound type per documented event/resource *shape* (e.g. create vs update), not a kitchen-sink `Message` with everything optional. Nested objects are shared only when Discord documents the same object.
- **Outbound model:** caller-built Rest body or query. Optional documented fields are omitted from the record (no `undefined` in `JSON.stringify`; scriptc stringify follows declaration order). JSON `null` is used only where Discord documents a clear. PATCH omit vs null stay distinct.
- 204 No Content → `void`.
- Discord JSON errors Decode to `{ code: number, message: string, errors?: unknown }`. How that value is thrown or surfaced is [Define failure, cancellation, and backpressure semantics](https://github.com/Ermianr/moon-discord/issues/12).

## Scalars and collections

- **Snowflake:** `type Snowflake = string` (unbranded). Outbound always string. Inbound: JSON string, or a `number` that is a safe integer (stringify); otherwise Decode fails. Never `bigint`.
- **Timestamp:** ISO8601 string. Not `Date`.
- Enumerated integers and flags: exported const objects (same pattern as **Intents**) and fields typed `number`. Decode does not expand bitfields into booleans. Callers combine with `|`.
- Documented JSON arrays → dense arrays (no holes). Documented JSON object maps → `Map<string, Inbound>`. No open index signatures / exact-record maps.

## Seams

- Typed Rest: success body Decode or the Promise fails. No half-filled inbound. Hatch: `execute({ method, path, query?, body?, auditReason? }) => Promise<unknown>` on success; still not the happy path; still not `any`. Hatch is not a substitute for a method promised at 1.0 ([Define 1.0 completeness and pre-1.0 milestones](https://github.com/Ermianr/moon-discord/issues/5)).
- Gateway: unreadable envelope header (`op` / `t`) is a protocol failure for [Define Gateway lifecycle and sharding semantics](https://github.com/Ermianr/moon-discord/issues/9). A readable catalog `t` with a payload that fails Decode does **not** kill the session and does **not** invoke `on(t)`.
- **Unknown dispatch** `{ t: string, d: unknown }` after header Decode: `t` outside the official catalog, or catalog `t` with failed payload Decode. **Client** observes this only via `onUnknownDispatch` (library method, not a fake Discord `t`). This extends [Choose the public Client experience](https://github.com/Ermianr/moon-discord/issues/4).

## Evolution

- New documented inbound field: additive optional copy (minor after 1.0; allowed in `0.x`).
- Remove/rename inbound, or make an outbound field newly required: breaking.
- New typed Rest method: additive.
- New or deferred route without a typed method: **Rest hatch**.
- Version numbers and CI: [Choose the delivery sequence and release gates](https://github.com/Ermianr/moon-discord/issues/13).
