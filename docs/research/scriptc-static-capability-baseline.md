# scriptc 0.0.36 static capability baseline

**Issue:** [moon-discord #2](https://github.com/Ermianr/moon-discord/issues/2)  
**Probe date:** 2026-09-06  
**Target:** Linux x86_64, glibc (host `uname`: `7.0.0-31-generic`, Ubuntu)  
**Compiler:** `scriptc 0.0.36` (`Node v24.20.0`)  
**Decision scope:** engine-free scriptc **static** tier only; no `--dynamic`, no runtime npm dependencies

## Decision

The initial moon-discord architecture is viable on scriptc 0.0.36’s static tier, with two load-bearing qualifications.

**REST is green on LLVM.** Native `fetch` is a static stdlib surface.[S2][S3] A compiled binary completed `GET https://discord.com/api/v10/gateway` (unauthenticated Get Gateway[D1]) and returned `200 true wss://gateway.discord.gg`. The verified subset covers method, record headers, JSON string bodies, `redirect`, `AbortSignal.timeout`, `status`/`ok`, `Headers.get`, `Headers.forEach`, `text()`, `json()` plus checked casts, and `bytes()`.

**Gateway transport must be owned in-tree.** There is no global `WebSocket` name (typecheck `SC0001`). Discord’s Gateway uses RFC 6455 over TLS 1.2.[D3][R1] A custom client can be built from static `node:tls`, `Buffer`/`Uint8Array`, `randomBytes`, SHA-1, timers, and JSON. A TLS + HTTP Upgrade to `gateway.discord.gg:443` succeeded (`HTTP/1.1 101` and matching `Sec-WebSocket-Accept`). Coverage reported that program fully static, but `--backend llvm` refuses `tls.connect` with `SC3001`; the default native build falls back to the engine-free C backend. Full RFC 6455 framing and an authenticated Gateway session remain **UNVERIFIED**.

Gateway **transport** compression must stay off initially: `inflateSync` round-trips independent zlib payloads, but `createInflate` is absent (`SC0001`) while Discord `zlib-stream` requires one shared inflater per connection plus a `00 00 ff ff` sync flush.[D1] Identify payload compression is a separate, still **UNVERIFIED** path (`inflateSync` has no shared context, matching Discord’s payload-compression note[D1]).

These conclusions are version-specific. scriptc is experimental; official docs say `scriptc coverage` on the actual program is authoritative, and several 0.0.36 probes disagree with the generated surface manifest.[S2][S5] Pin the compiler and keep these probes as release gates.

## Evidence labels

| Label | Meaning |
| --- | --- |
| **VERIFIED-RUNTIME** | `scriptc coverage` reported 100% static, a native binary built without `--dynamic`, and the binary exercised the capability successfully. |
| **VERIFIED-COMPILE** | Static coverage and build succeeded, but the specific production behavior was not exercised. |
| **BLOCKED** | The tested program failed typecheck, coverage, or build with the stated diagnostic. |
| **SOURCE-ONLY** | Claimed by a primary source but not exercised by these probes. |
| **UNVERIFIED** | Not established by either an applicable probe or a sufficiently specific primary-source statement. Do not design as if it works. |

`--backend llvm` was used on positive probes except where the purpose was C-fallback (`tls.connect` / `tls.createServer` / `https.createServer`). Both backends are engine-free static compilation; C fallback is not `--dynamic`.[S4]

## Capability matrix

| Area | Static-tier status in 0.0.36 | Verified surface | Limits and diagnostics | moon-discord constraint |
| --- | --- | --- | --- | --- |
| `fetch` / HTTPS REST | **VERIFIED-RUNTIME** | Local `node:http` + `fetch` POST (method, record headers, JSON body, `redirect: "follow"`, `AbortSignal.timeout`, `status`, `ok`, `headers.get`, `text()`); `json()` + checked cast; `bytes()`; `Headers.forEach`; direct `GET https://discord.com/api/v10/gateway` → `200 true wss://gateway.discord.gg`. LLVM builds. | `Response.arrayBuffer()` is `SC2020` (use `bytes()`).[S2][S7] `new Headers(...)` is `SC2020`. `for (const pair of headers)` is `SC2020` (`Headers.[Symbol.iterator]` dynamic-only).[S2] Manifest marks `RequestInit.cache`, `credentials`, `integrity`, `keepalive`, `mode`, `priority`, `referrer`, `referrerPolicy`, `window` unsupported; this environment’s fallback `RequestInit` omits `keepalive`, so the probe failed the typecheck gate (`SC0001`) rather than `SC2020`. `FormData` is `SC0001` (`Cannot find name 'FormData'`). Manifest `BodyInit` is string / `Uint8Array` / `ReadableStream` / null.[S2] `Request` constructor is unsupported.[S2] Proxy behavior is **UNVERIFIED** (not re-probed 2026-09-06). | Implement REST over global `fetch`. Set Discord `User-Agent`, versioned `/api/v10` path, and `Authorization: Bot …` as required.[D3] Read known rate-limit headers with `Headers.get` (or `forEach` if discovering names). Consume binary bodies with `bytes()`. Encode JSON as strings or `Uint8Array`. Keep multipart out of the initial API. |
| `node:http` | **VERIFIED-RUNTIME** | Loopback server handled native `fetch` POST. | Manifest: HTTP member coverage is not fully projected; module recognition ≠ every method.[S2] | Prefer `fetch` for the REST client. Probe any extra `http` member before using it in core. |
| `node:https` | **VERIFIED-RUNTIME** (client LLVM; server C fallback) | `https.request` HEAD to `example.com` → `https-status:200` under LLVM. Loopback `https.createServer` + client → `https:secure` with C fallback (`libCall:https.createServer`). | `https.createServer` is frontend-static; LLVM refuses `SC3001`. | REST stays on `fetch` + LLVM. Do not put an HTTPS server in the core client. |
| `node:net` | **VERIFIED-RUNTIME** | Loopback echo (`net:pong`) and `connect(port, "localhost")` (`dns`) under LLVM. Typed `(chunk: Buffer)` + `toString("utf8")`. | Untyped `data` payloads can hit `SC2020` on `Buffer<ArrayBufferLike>`. Probe used `localhost` / `127.0.0.1`, not arbitrary public DNS except via `tls`/`fetch`. | Type socket event payloads. Treat sockets as byte streams (split/coalesced records). |
| `node:tls` | **VERIFIED-RUNTIME**, static C fallback | Loopback self-signed exchange (`tls:secure`). Direct `gateway.discord.gg:443` with `servername` + `rejectUnauthorized: true` completed TLS, HTTP `101`, and `Sec-WebSocket-Accept` check. Coverage 22/22 static. `example.com:443` `secureConnect` printed `tls`. | `--backend llvm` → `SC3001` (`libCall:tls.connect` / `tls.connectCb`). Default: `scriptc: backend c (llvm refused: …)`. Generated manifest labels `tls.connect` **unsupported/`SC2020`** and says the lowered TLS client is `https.request`.[S2] That contradicts the installed compiler. Only the tested option shape is evidence. Linux TLS uses vendored mbedTLS plus distro CA probing.[S4][S6] | Gateway may use raw `tls.connect`, allowing default C fallback. Pin 0.0.36. Keep a live Upgrade smoke test. Do not generalize to untested options (custom CAs, proxies, client certs, renegotiation). C-backend hot-path performance is **UNVERIFIED**. |
| WebSocket API | **BLOCKED** as a built-in; handshake primitives **VERIFIED-RUNTIME** | Opening-handshake crypto (16 random bytes, base64, SHA-1/base64 sizes 24/28) and Discord Upgrade succeeded. Typed-array XOR masking primitives compiled on LLVM. | `new WebSocket(...)` → `SC0001: Cannot find name 'WebSocket'`. Frame parser, fragmentation, ping/pong, close handshake, 64-bit length path, and authenticated Gateway session: **UNVERIFIED**. RFC 6455 requires fresh unpredictable client masks, incremental framing, control-frame interleave, UTF-8 failure behavior, and close rules.[R1] | Implement a small **internal** RFC 6455 client over `node:tls`. Do not import npm `ws`. Cap frame/message sizes. Decode 64-bit lengths as high/low numbers; reject over the safe limit — `bigint` is **BLOCKED**. |
| Timers / event loop | **VERIFIED-RUNTIME** | `setTimeout`/`clearTimeout`, `setInterval`/`clearInterval`, `setImmediate`, `queueMicrotask`, `node:timers/promises.setTimeout`, `async`/`await`. Output: `microtask`, `immediate`, `ticks:2`; cancelled timeout did not fire. LLVM. | Wall-clock jitter under load **UNVERIFIED**. Linux event loop is epoll; timers share the dependency-free loop.[S4][S6] Manifest: timer member surface is not fully projected.[S2] | Heartbeat is a session state machine: first beat after `heartbeat_interval * jitter` (`jitter` in `[0, 1)`), then every interval; missing ACK before the next beat → close **other than** 1000/1001 and Resume.[D1] Use cancellable one-shot deadlines so reconnect invalidates old timers. |
| `node:zlib` | **VERIFIED-RUNTIME** for one-shot zlib only | `deflateSync` + `inflateSync` round trip on LLVM: `zlib:gateway-payload exists:true`. | `gzipSync` → `SC2020`. `createInflate` → `SC0001` (not in fallback declarations). Manifest: only `deflateSync` and `inflateSync` are lowered.[S2] Discord `zlib-stream` needs a persistent inflater and `Z_SYNC_FLUSH` (`00 00 ff ff`).[D1] `zstd-stream` has no static decoder here. | Connect with `?v=10&encoding=json` and **omit** `compress`. Do not advertise `zlib-stream`/`zstd-stream`. Leave Identify `compress: true` off until separately probed. |
| `node:crypto` | **VERIFIED-RUNTIME** for the narrow slice | `randomBytes(16)`, `randomUUID()`, `createHash("sha256").update(...).digest("hex")` (digest `0428680faa0c023040f1ac245b8d78f474a8669c308536e88dbf12dd58f4852a`), SHA-1 + `digest("base64")` for RFC 6455 sizes. LLVM. | Manifest `createHash` row is **unsupported/`SC2020`** with a note that the lowered shape is `createHash("sha256").update(data).digest("hex")`; HMAC note separately names `sha256`\|`sha1`.[S2] Installed compiler accepted SHA-1 and `digest("base64")` — source/probe conflict. `createHmac` → `SC0001`. Manifest: no HMAC, ciphers, KDFs, KeyObjects, signatures, WebCrypto.[S2] TLS is mbedTLS, not this `crypto` slice.[S4] | Use crypto for WS nonce/masks, handshake SHA-1, SHA-256 where needed, and IDs. Do not design Ed25519 interaction verify, HMAC, AES, or KeyObjects on this surface until a later verified lowering or FFI. |
| `JSON.parse` / `Response.json` checked casts | **VERIFIED-RUNTIME** | `JSON.parse` → `unknown` → checked cast to a concrete nested record; mismatch threw `expected number at $.op, got string`. Extra JSON fields on a `{ op: number }` header were accepted (`10`). Two-stage opcode decode printed `45000`. `Response.json() as Reply` ran. | Cast target `{ op: number; d: unknown; ... }` → `SC1090` (validation types must be JSON-representable).[S5] Direct operations on `unknown` beyond the documented surface need a checked cast.[S5] Records are exact structs (`SC2002` extra fields on **typed** flows).[S5] Discord JSON is open.[D1][D3] | Parse once to `unknown`. Cast to a minimal concrete header; route on `op`/`t`; recast the **same** raw value to a fully concrete opcode/event struct. Never put `unknown` in a cast target. Copy known fields into owned closed structs. Catch validation errors at the decode seam. |
| Core TypeScript constructs | **VERIFIED-RUNTIME** for the tested set | Classes, generic class, generic async function, `Promise.resolve`, `async`/`await`, discriminated unions + `switch` narrowing, `try`/`finally`, named and default relative modules, `Buffer`, `Uint8Array`, loops, XOR. Output `types:7:READY` / `finally`; named import `42`; default import `7`. | `bigint` **BLOCKED** (`SC2001` + `SC1090` `BigIntLiteral`). Dense arrays: OOB / empty `pop` hard-trap, not catchable.[S5] Generic/union/exact-record edges remain fenced.[S5] Manifest marks default imports unsupported (`SC1012`) but the relative default-import probe compiled.[S2] Language tour: classes with single inheritance, monomorphized generic functions, discriminated unions, `async`/`await`.[S3] | Snowflakes are **strings** (Discord JSON; 64-bit IDs).[D3] Guard every array index. Prefer named exports. Narrow unions before member access. Call lowered builtins directly (`Math.floor(x)`). Coverage every new construct. |
| `any` | **Do not rely on it** | `function ident(value: any): any` reported 100% static, LLVM-built, printed `x`. | Official contract: `any` without `--dynamic` is `SC2011` (dynamic-only).[S2][S3][S5] Class field typed `any` **BLOCKED** (`SC1090` `'unknown'-typed class fields`). Empirical param/`return` acceptance is **UNVERIFIED/UNCONTRACTED**. | Ban `any` in production. Use concrete types; `unknown` only at immediate validation boundaries. A future compiler tightening must not force `--dynamic`. |
| npm dependencies | **BLOCKED by policy** | No runtime npm package was required. | npm implementations run in the `--dynamic` island (`SC2013`). `--npm-static` is experimental.[S8] | Own hot-path and transport TypeScript over supported builtins. No `ws` / `undici` / `discord.js` in the runtime graph. |

## Explicit architecture constraints

Requirements, not suggestions.

### Build and release

1. Pin `scriptc` to `0.0.36` until this matrix is rerun.
2. Every shipping entry point must pass `scriptc coverage <entry>` with `fully static` and no dynamic sites.[S7]
3. Never pass `--dynamic`. Do not use `--npm-static` as a substitute for repository-owned code.[S8]
4. Build the REST-only path with `--backend llvm` so CI fails instead of silently falling back to C.[S4]
5. Build the Gateway path with the **default** backend (`tls.connect` needs static C fallback). Assert the only accepted fallback note is a known transport site (`libCall:tls.connect` / `tls.connectCb`).
6. “Static tier” means no JS engine, no Node runtime, no runtime `node_modules`. It does **not** mean a fully static ELF: probed binaries were dynamically linked to `libc`, `libm`, and `libz`.[S3][S4]

### REST

1. `RestTransport` is a small repository-owned adapter over global `fetch` (deep module: buckets, User-Agent, retries hidden).
2. Construct requests from strings, `Uint8Array`, and record headers. Pin `https://discord.com/api/v10`. Set `User-Agent: DiscordBot ($url, $versionNumber)` and `Authorization: Bot <token>` where required.[D3]
3. Honor Discord rate limits from headers, not hardcoded quotas: `X-RateLimit-Bucket`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-RateLimit-Reset-After`, `X-RateLimit-Scope`, `Retry-After` / body `retry_after`. Global cap **50 requests/second** unless a documented surface (interaction callbacks) says otherwise.[D2]
4. Decode JSON with concrete checked casts. Use `Response.bytes()` for byte bodies.
5. Keep multipart uploads out of the initial API (`FormData` **BLOCKED**).
6. Do not claim HTTP-proxy support until probed.

### Gateway transport

1. Hide RFC 6455, TLS, framing, timers, and compression behind an internal seam. Public `Client` does not expose sockets.
2. Handshake over `tls.connect` with DNS hostname, `servername`, and `rejectUnauthorized: true`. Fresh 16-byte key, version 13, validate `101`, `Upgrade`, `Connection`, and SHA-1/base64 `Sec-WebSocket-Accept`.[R1]
3. Incremental byte-stream parser: split/coalesced input, continuation frames, interleaved control frames, text/binary, ping/pong, close, minimal length encodings, UTF-8 failure.[R1]
4. Mask every client frame with a fresh unpredictable 32-bit key from `randomBytes(4)`; server frames must be unmasked.[R1]
5. Conservative frame and reassembled-message limits. No `bigint`. Reject 64-bit lengths above the configured maximum.
6. Connect `?v=10&encoding=json` with no `compress` query. Do not set Identify `compress: true` until one-shot payload compression is tested.[D1]
7. Do not negotiate WebSocket extensions; RSV bits stay zero unless a verified extension exists.[R1]
8. A successful opening handshake is not a complete Gateway transport.

### Gateway session and decode

1. Decode each incoming JSON message once to `unknown`.
2. Checked-cast to a minimal concrete header such as `{ op: number }` (extra fields were accepted on this probe).
3. Route on `op` (and dispatch `t`); recast the same raw value to a fully concrete record. `d: unknown` in a cast target is `SC1090`.
4. Snowflakes are strings.[D3]
5. Store latest non-null `s`, `session_id`, and `resume_gateway_url`. Follow Discord’s Hello / Identify / Resume / Invalid Session / close-code machine.[D1]
6. First-heartbeat jitter, periodic heartbeat, ACK deadline, reconnect backoff, and Identify concurrency are explicit state transitions, not fire-and-forget intervals.[D1]

### Performance

1. Decode, frame parse/mask, heartbeat, and REST dispatch are hot paths: no extra JSON parses, no unbounded copies.
2. Benchmark the C-backend Gateway path before calling Gateway complete.
3. Guard every index: dense-array traps abort and are not catchable.[S5]

## Reproducible environment

```console
$ scriptc --version
0.0.36
$ node --version
v24.20.0
$ uname -a
Linux ... 7.0.0-31-generic ... x86_64 GNU/Linux
$ command -v clang
/usr/bin/clang
$ readlink -f "$(command -v scriptc)"
/home/kevin/.local/share/fnm/node-versions/v24.20.0/installation/lib/node_modules/scriptc/dist/bootstrap.js
```

Local generated surface: `…/node_modules/@scriptc/compiler/surface-manifest.json` with `compilerVersion: "0.0.36"`, `schemaVersion: 1`. Tag `v0.0.36` points at commit `908098616601b35f31a0209c5b84b140a7df66a5`.[S1]

Probe files lived under `/tmp/scriptc-probes-20260906` (not in git). Sequence for LLVM-capable programs:

```console
scriptc coverage probe.ts
scriptc build probe.ts --backend llvm --no-keep-c -o probe
./probe
```

For TLS / HTTPS-server programs, omit `--backend llvm`:

```console
scriptc coverage probe.ts
scriptc build probe.ts --no-keep-c -o probe
# stderr includes: scriptc: backend c (llvm refused: libCall:…)
./probe
```

## Reproducible probes and observed results

Observed 2026-09-06 on this host. Coverage statement counts are for the exact `/tmp` programs (slightly more verbose than the 2026-09-05 draft).

### 1. Direct Discord REST over native `fetch`

```ts
type GatewayReply = { url: string };

async function main(): Promise<void> {
  const response = await fetch("https://discord.com/api/v10/gateway", {
    signal: AbortSignal.timeout(10_000),
  });
  const reply = await response.json() as GatewayReply;
  console.log(response.status, response.ok, reply.url);
}

main();
```

```console
$ scriptc coverage rest-discord.ts
  statements analyzed   4
  compile statically    4  (100%)
  fully static — this program has no dynamic remainder.
$ scriptc build rest-discord.ts --backend llvm --no-keep-c -o rest-discord
$ ./rest-discord
200 true wss://gateway.discord.gg
```

Get Gateway does not require authentication.[D1]

`ldd ./rest-discord` showed `libz.so.1`, `libm.so.6`, `libc.so.6` (PIE ELF, dynamically linked).

### 2. Local Fetch / HTTP subset

Loopback `createServer` + POST `fetch` with JSON body and `headers.get("x-probe")`:

```console
  statements analyzed   14
  compile statically    14  (100%)
$ ./rest-local
200 true static {"method":"POST","ok":true}
```

`Response.json() as { op: number; ok: boolean }` plus a second `bytes()` fetch:

```console
  statements analyzed   14
  compile statically    14  (100%)
$ ./rest-bytes
reply:10 bytes:19
```

`Headers.get` of `X-RateLimit-Bucket`: coverage 11/11 static; runtime `abcd`.  
`Headers.forEach`: coverage 12/12 static; runtime printed `x-ratelimit-bucket=abcd` among hop-by-hop headers.

Negative:

```console
$ scriptc coverage response-array-buffer.ts
  statements analyzed   4
  compile statically    2  (50%)
  ×1 'Response.arrayBuffer() in a static build' ... SC2020
  ×1 'ArrayBuffer.byteLength' ... SC2020

$ scriptc coverage fetch-keepalive.ts
  not analyzable: 1 TypeScript error
  'keepalive' does not exist in type 'RequestInit'. SC0001

$ scriptc coverage headers-iter.ts
  ×1 'Headers.[Symbol.iterator] in a static build' ... SC2020

$ scriptc coverage headers-ctor.ts
  ×1 'new Headers' ... SC2020

$ scriptc coverage formdata.ts
  not analyzable: Cannot find name 'FormData'. SC0001
```

### 3. Raw TLS and Discord WebSocket opening handshake

`gateway-handshake.ts`: `randomBytes` + SHA-1 accept value + `tls.connect({ host, port: 443, servername, rejectUnauthorized: true })` + HTTP/1.1 Upgrade `GET /?v=10&encoding=json`. Needs **direct** outbound TCP; an HTTP proxy cannot carry this socket.

```console
$ scriptc coverage gateway-handshake.ts
  statements analyzed   22
  compile statically    22  (100%)
  fully static — this program has no dynamic remainder.
$ scriptc build gateway-handshake.ts --no-keep-c -o gateway-handshake
scriptc: backend c (llvm refused: libCall:tls.connectCb)
$ ./gateway-handshake
true true

$ scriptc build gateway-handshake.ts --backend llvm --no-keep-c -o gateway-llvm
error SC3001: the LLVM backend does not support this construct yet (libCall:tls.connectCb)
```

Loopback certificates: `openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 1 -subj /CN=localhost`.

```console
$ scriptc build tls-loopback.ts --no-keep-c -o tls-loopback
scriptc: backend c (llvm refused: libCall:tls.createServerCb)
$ ./tls-loopback
tls:secure

$ scriptc build https-loopback.ts --no-keep-c -o https-loopback
scriptc: backend c (llvm refused: libCall:https.createServer)
$ ./https-loopback
https:secure

$ scriptc build https-client.ts --backend llvm --no-keep-c -o https-client
$ ./https-client
https-status:200

$ scriptc build tls-connect.ts --backend llvm --no-keep-c -o tls-connect-llvm
error SC3001: ... (libCall:tls.connect)
$ scriptc build tls-connect.ts --no-keep-c -o tls-connect
scriptc: backend c (llvm refused: libCall:tls.connect)
$ ./tls-connect
tls
```

### 4. Built-in WebSocket rejection and framing prerequisites

```console
$ scriptc coverage websocket.ts
  not analyzable: Cannot find name 'WebSocket'. SC0001
```

Handshake crypto (LLVM): `24 28` (key and accept string lengths).  
XOR mask probe (LLVM): `5 73`. These prove primitives lower; they are **not** a compliant frame implementation.

### 5. Timers

```console
$ scriptc coverage timers.ts
  statements analyzed   14
  compile statically    14  (100%)
$ ./timers
microtask
immediate
ticks:2
```

### 6. zlib

```console
$ ./zlib-roundtrip
zlib:gateway-payload exists:true

$ scriptc coverage gzip.ts
  ×1 'zlib.gzipSync' ... SC2020

$ scriptc coverage stream-inflate.ts
  not analyzable: Module 'node:zlib' has no exported member 'createInflate'. SC0001
```

### 7. crypto

```console
$ ./crypto-probe
crypto:0428680faa0c023040f1ac245b8d78f474a8669c308536e88dbf12dd58f4852a bytes:16 uuid-length:36

$ scriptc coverage hmac.ts
  not analyzable: '"node:crypto"' has no exported member named 'createHmac'. SC0001
```

### 8. Checked JSON decoding

Concrete nested cast (LLVM): `json:2` then `cast:expected number at $.op, got string`.  
Two-stage opcode decode: `45000`.  
Extra field `extra: true` beside `op`: coverage 3/3; runtime `10`.  
Open envelope with `d: unknown`:

```console
$ scriptc coverage json-unknown-d.ts
  statements analyzed   3
  compile statically    2  (66%)
  ×1 a checked cast of 'unknown' to '{ d: unknown; ... }'
     can only be validated against JSON-representable types ... SC1090
```

### 9. TypeScript constructs, modules, `any`, `bigint`

Core types probe: `types:7:READY` / `finally`.  
Named relative import: `42`. Default relative import: `7` (manifest conflict).  
`any` parameter identity: coverage 2/2 static; runtime `x` (**uncontracted**).  
`any` class field:

```console
$ scriptc coverage any-field.ts
  compile statically    0  (0%)
  ×1 'unknown'-typed class fields  SC1090
```

```console
$ scriptc coverage bigint.ts
  compile statically    0  (0%)
  ×1 values of type '123456789012345678n' cannot be compiled yet  SC2001
  ×1 syntax 'BigIntLiteral'  SC1090
```

### Summary of positive runs (2026-09-06)

| Probe | Static coverage | Build lane | Runtime result |
| --- | ---: | --- | --- |
| Direct Discord Fetch | 4/4 | LLVM | `200 true wss://gateway.discord.gg` |
| Local HTTP + Fetch POST | 14/14 | LLVM | `200 true static {"method":"POST","ok":true}` |
| Fetch `json()` + `bytes()` | 14/14 | LLVM | `reply:10 bytes:19` |
| `Headers.get` rate-limit name | 11/11 | LLVM | `abcd` |
| `Headers.forEach` | 12/12 | LLVM | includes `x-ratelimit-bucket=abcd` |
| Extra JSON fields + `{ op: number }` | 3/3 | LLVM | `10` |
| `net` loopback | 15/15 | LLVM | `net:pong` |
| `net` `localhost` | 13/13 | LLVM | `dns` |
| HTTPS client HEAD | 6/6 | LLVM | `https-status:200` |
| HTTPS loopback server | 21/21 | Static C fallback | `https:secure` |
| TLS loopback server | 18/18 | Static C fallback | `tls:secure` |
| TLS client `example.com` | 6/6 | Static C fallback | `tls` |
| Discord TLS + WS Upgrade | 22/22 | Static C fallback | `true true` |
| Timers | 14/14 | LLVM | `microtask`, `immediate`, `ticks:2` |
| zlib deflate/inflate | 3/3 | LLVM | `zlib:gateway-payload exists:true` |
| SHA-256 / random / UUID | 4/4 | LLVM | expected digest, 16 bytes, UUID length 36 |
| SHA-1 / base64 WS values | 3/3 | LLVM | `24 28` |
| Concrete checked JSON cast | 8/8 | LLVM | valid + pathful mismatch |
| Two-stage checked decode | 6/6 | LLVM | `45000` |
| Core TS constructs | 10/10 | LLVM | `types:7:READY`, `finally` |
| Typed-array masking primitives | 6/6 | LLVM | `5 73` |
| Named relative module | 2/2 | LLVM | `42` |
| Default relative module | 2/2 | LLVM | `7` |
| Uncontracted `any` params | 2/2 | LLVM | `x` — **do not use** |

## Source/probe conflicts and unverified claims

1. **Raw `tls.connect`:** generated 0.0.36 manifest = unsupported `SC2020`, lowered TLS client supposedly `https.request` only.[S2] Installed compiler: 100% static coverage, C-fallback binary, live Discord Upgrade. Trust the compiler for the **tested call shape**; do not treat the rest of `tls` as a contract. Coverage vs build: coverage is static; LLVM build is `SC3001` unless C fallback is allowed.[S4][S5]
2. **`createHash`:** manifest `createHash` entry is unsupported except `sha256`+`digest("hex")`; HMAC note also names `sha1`.[S2] Probe: `sha1` + `digest("base64")` compiled and produced RFC 6455-sized strings. Treat SHA-1/base64 as empirically available in 0.0.36, still pin a coverage gate.
3. **`any`:** docs/manifest `SC2011` dynamic-only.[S2][S5] Param/`return` `any` compiled statically; class-field `any` was `SC1090`. Uncontracted. Ban in product code.
4. **Default imports:** manifest `SC1012` unsupported;[S2] relative default import compiled. Prefer named exports until sources agree.
5. **`RequestInit.keepalive`:** manifest `SC2020`; this install failed earlier at `SC0001` (property absent from fallback `RequestInit`). Same architectural outcome: do not use it.
6. **Full WebSocket / Gateway session:** only TLS + opening Upgrade verified. Framing, control frames, fragmentation, close, Heartbeat/Identify/Ready: **UNVERIFIED**.
7. **Compression:** one-shot zlib only. Transport `zlib-stream` architecturally blocked (no streaming inflater). Payload compression **UNVERIFIED** against Discord.
8. **Performance:** no throughput/latency/allocation/size benchmarks. C-backend Gateway hot path **UNVERIFIED**.
9. **Untested members:** a recognized Node module does not imply its complete Node surface.[S2]
10. **HTTP proxies:** not re-probed on 2026-09-06 (**UNVERIFIED**). Direct `fetch` and raw TLS succeeded on this host.

## Primary sources

- **[S1]** scriptc, [v0.0.36 release](https://github.com/vercel-labs/scriptc/releases/tag/v0.0.36); git ref `refs/tags/v0.0.36` → commit `908098616601b35f31a0209c5b84b140a7df66a5` (GitHub Git API). Assets include [surface-manifest.json](https://github.com/vercel-labs/scriptc/releases/download/v0.0.36/surface-manifest.json).
- **[S2]** Installed copy of that generated surface (`compilerVersion: "0.0.36"`). Entries are mechanically projected; absence means “not projected”, never “unsupported”. HTTP/TLS module **members** are listed among non-projected surfaces except the explicit `tls.connect` row.
- **[S3]** scriptc, [Introduction](https://scriptc.dev/introduction): three tiers; static Node surface including `net`/`http`/`https`/`tls`/`crypto`/`zlib`/timers/`fetch`; checked casts; `--dynamic` for npm/`any`.
- **[S4]** scriptc, [How it works](https://scriptc.dev/how-it-works): LLVM default with C fallback (one stderr note; `--backend llvm` pins and fails); epoll on Linux; vendored mbedTLS; no engine unless `--dynamic`.
- **[S5]** scriptc, [Limitations](https://scriptc.dev/limitations): coverage is the real answer; `any`/`SC2011`; exact records; `unknown` operations; dense-array traps; checked-cast path errors.
- **[S6]** scriptc, [Platforms](https://scriptc.dev/platforms): Linux x64 glibc helper + runtime pack; epoll; TLS + distro CA probing; servers/`fetch` on the Linux surface.
- **[S7]** scriptc, [Coverage](https://scriptc.dev/coverage): `fully static` verdict; `Response.arrayBuffer` / `Response.bytes` example; type errors gate analysis.
- **[S8]** scriptc, [Dependencies](https://scriptc.dev/dependencies): npm → `--dynamic` island; `--npm-static` experimental.
- **[D1]** Discord, [Gateway](https://docs.discord.com/developers/events/gateway): `v=10&encoding=json`; `compress=zlib-stream`/`zstd-stream`; payload vs transport compression; Hello/heartbeat/ACK/zombie close; Get Gateway unauthenticated.
- **[D2]** Discord, [Rate limits](https://docs.discord.com/developers/topics/rate-limits): do not hard-code limits; bucket headers; 429 `retry_after` / `Retry-After`; global 50 rps; invalid-request Cloudflare bans.
- **[D3]** Discord, [API reference](https://docs.discord.com/developers/reference): API v10; TLS 1.2; `Authorization`; `User-Agent: DiscordBot ($url, $versionNumber)`; snowflakes as strings; Gateway = RFC 6455.
- **[R1]** IETF, [RFC 6455](https://datatracker.ietf.org/doc/html/rfc6455): opening handshake and `Sec-WebSocket-Accept` (GUID `258EAFA5-E914-47DA-95CA-C5AB0DC85B11`); client MUST mask with a fresh unpredictable 32-bit key; framing and close.

Installed compiler (not a web page, but the artifact under test): `scriptc 0.0.36` at `…/node_modules/scriptc/dist/bootstrap.js`.
