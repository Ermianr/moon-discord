# HTTP Interactions signature verify on the static tier

**Issue:** [Choose how HTTP Interactions signatures verify on the static tier](https://github.com/Ermianr/moon-discord/issues/15)  
**Decision date:** 2026-09-06  
**ADR:** `docs/adr/0012-http-interaction-signature-verify.md`  
**Baseline:** `docs/research/scriptc-static-capability-baseline.md` (scriptc 0.0.36)

## Question

How should Discord HTTP Interactions Endpoint URL verification (Ed25519 over the documented timestamp + raw body) work on scriptc 0.0.36, given that the verified `node:crypto` surface has no signatures, HMAC, KeyObjects, or WebCrypto?

## Answer

Own a **verify-only** Ed25519 implementation in repository TypeScript: `number[]` field arithmetic and `Uint8Array` bytes, no `bigint`, no `Float64Array`, no runtime npm. It lives in the **Rest** compile graph behind `handleInteractionRequest` — not a fifth deep module, not a public function, not an **Adapter**. Gateway `INTERACTION_CREATE` plus HTTP callback/followup routes do not use this path.

HTTP Interactions Endpoint URL remains **1.x** completeness ([Define 1.0 completeness and pre-1.0 milestones](https://github.com/Ermianr/moon-discord/issues/5)). This note locks the verify contract so that cut is implementation, not another architecture ticket.

If a later scriptc lowering exposes `crypto.verify` (or equivalent) with static coverage, **replace the port internally**. The **Client** interface does not change.

## Discord protocol (authoritative)

Interactions Endpoint URL traffic is HTTP POST with:[S1]

- `X-Signature-Ed25519` — hex signature
- `X-Signature-Timestamp` — timestamp string
- raw body as a **string**, not pre-parsed JSON

Signed message = `timestamp + body`. Public key is the hex application public key from the Developer Portal. Official JS sample uses `nacl.sign.detached.verify`. Fail validation → HTTP **401**. Discord also sends automated invalid signatures; failing those checks **removes the URL**.[S1]

`PING` (`type: 1`) must be ACKed with HTTP 200 and body `{ "type": 1 }` (`PONG`).[S1][S2]

## scriptc 0.0.36 (verified)

| Surface | Result |
| --- | --- |
| `node:crypto` `verify` / `webcrypto` | **BLOCKED** (`SC0001`, not in fallback typings). Manifest: no signatures, HMAC, KeyObjects, WebCrypto.[S3][S4] |
| `Float64Array` (tweetnacl’s `gf` type) | **BLOCKED** (`SC2020`, no lowering). Probe 2026-09-06. |
| `number[]` limb math, `Uint8Array` | **VERIFIED-RUNTIME** LLVM. |
| FFI `bytes, bytes, bytes → bool` | **VERIFIED-RUNTIME** LLVM with `--ffi`, but consumers would need a native archive and `--ffi` on `scriptc build`. |

`--dynamic` plus npm `tweetnacl` is a product regression. Outbound FFI is a real static path and was rejected for **DX** and the packaging contract (`--npm-static moon-discord`, no published `--lib` / `.a` as the product).[S5]

## Public Client contract

Constructor option `publicKey?: string` (hex, Developer Portal). Optional for REST-only and Gateway bots. `handleInteractionRequest` without it is **configuration error** (`ConfigurationError`), before I/O.

```ts
const client = new Client({ token, publicKey });

const http = await client.handleInteractionRequest({
  body, // raw HTTP body string
  headers: { signature: string, timestamp: string },
});
// caller writes http.status and http.body
```

`body` is the raw request string. The **Client** verifies, then `JSON.parse` → `unknown` → **Decode**. Parsed `unknown` is not a legal input: it cannot reconstruct the signed bytes.

No exported `verify` / `sign`. Callers who do not use **Client** are out of this product’s HTTP-ingest story.

## Verify outcomes

Production verify always runs (including `createTestClient`). There is no skip flag.

| Input | Result | **Decode** / `on("INTERACTION_CREATE")` |
| --- | --- | --- |
| Missing `publicKey` on handle | throws `ConfigurationError` | no |
| Missing headers, illegal hex, wrong lengths, or Ed25519 fail | **returns** `{ status: 401, body: "invalid request signature" }` | no |
| Verified `PING` | returns `{ status: 200, body }` JSON `{"type":1}` | no (`PING` is not Dispatch) |
| Verified body that fails **Decode** | rejects `DecodeError` | no |
| Verified interaction **Decode** | emit `on("INTERACTION_CREATE")`; return `{ status: 202, body: "" }` so the caller’s server ACKs the POST while answers go through callback **Rest** | yes |

401 is Discord protocol, not a **Client** crash. Throwing would make callers map errors to HTTP; a missed mapping deletes the Interactions Endpoint URL.[S1] **DecodeError** after a good signature stays a throw ([Define failure, cancellation, and backpressure semantics](https://github.com/Ermianr/moon-discord/issues/12)): the caller’s server chooses the status for a malformed-but-signed body.

No timestamp skew window. Discord’s documented check is the signature over timestamp+body; **Clock** is not part of this path.

Fail closed on encoding: non-hex, odd-length hex, signature ≠ 64 bytes, public key ≠ 32 bytes → same 401 (do not distinguish “malformed” from “bad signature” on the wire).

## Compile graph

`moon-discord/rest` includes the verifier. No third export. REST-only LLVM programs that never call the handle still compile the TypeScript; that cost is accepted so `--backend llvm` and `--npm-static moon-discord` stay unchanged. Unverified `import()` / DCE is not a lane split.

Ed25519 is **not** an **Adapter**. One production implementation. `node:crypto` SHA-1 for RFC 6455 stays unrelated (Gateway transport).

## Tests

Seam: `handleInteractionRequest` on **Client**.

`moon-discord/testing` may **sign** fixtures with a test key so tests present real headers and observe 200 / 202 / 401. Sign is not a public `moon-discord` export. Include RFC 8032 verify vectors and at least one Discord-shaped message (`timestamp + body`).

## Considered options

| Design | Keep | Drop |
| --- | --- | --- |
| Wait for scriptc `crypto.verify` | Later internal swap | Leaves HTTP ingest unverifiable on 0.0.36 |
| FFI libsodium / mbedTLS | Native correctness | `--ffi` + `.a` on every consumer; fights packaging |
| npm `tweetnacl` / noble | Familiar | `--dynamic` / island; `Float64Array` / `bigint` blockers |
| Caller-supplied verify **Adapter** | Unblocks without owning crypto | Leaks the seam; two production paths |
| Parsed `body: unknown` | Matches an early Client sketch | Breaks the signed string |
| Throw on bad signature | Matches other async failures | Easy to return 200; Discord removes the URL |
| Timestamp max-age | Replay folklore | Not in official verify samples |
| Pull HTTP ingest into `1.0` | Static path now exists | Reopens the completeness cut for a 1.x surface |

## Explicit non-decisions

- Exact TypeScript layout of the port (file names, limb helpers) — implementation.
- Whether a future scriptc Ed25519 lowering lands in 0.0.x or later — swap when coverage is static.
- Caller HTTP framework (Express, `node:http`, etc.).
- Outgoing Webhook Events verify, if Discord uses the same headers there — 1.x product, not this path.

## Primary sources

- **[S1]** Discord, [Interactions Overview](https://docs.discord.com/developers/interactions/overview): Endpoint URL vs Gateway mutex; `PING`/`PONG`; `X-Signature-Ed25519` / `X-Signature-Timestamp`; JS `tweetnacl` sample (`rawBody` string); 401; automated invalid signatures remove the URL.
- **[S2]** Discord, [Receiving and Responding](https://docs.discord.com/developers/interactions/receiving-and-responding): interaction types; HTTP callback/followup; 202 when answering via callback.
- **[S3]** `docs/research/scriptc-static-capability-baseline.md` and generated scriptc 0.0.36 surface: hashing/randomness only; `createVerify` / `verify` / `webcrypto` unsupported.
- **[S4]** Probes 2026-09-06 on this host: `verify`/`webcrypto` `SC0001`; `Float64Array` `SC2020`; `number[]` LLVM; FFI LLVM `true`.
- **[S5]** [Choose the packaging and artifact contract](https://github.com/Ermianr/moon-discord/issues/6) (`docs/research/packaging-and-artifact-contract.md`): consumer `scriptc build --npm-static moon-discord`; no published `--lib` archive.
- **[S6]** IETF, [RFC 8032](https://datatracker.ietf.org/doc/html/rfc8032): Ed25519 test vectors for the owned verifier.
