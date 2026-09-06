# Static-tier encoding for Discord multipart REST

**Issue:** [Choose a static-tier encoding for Discord multipart REST](https://github.com/Ermianr/moon-discord/issues/14)  
**Decision date:** 2026-09-06  
**ADR:** `docs/adr/0010-static-tier-multipart-encoding.md`  
**Compiler pin:** scriptc 0.0.36 (same as [the static capability baseline](./scriptc-static-capability-baseline.md))

## Question

How should 1.0 fulfill Discord’s documented multipart and attachment REST operations on scriptc 0.0.36, given that `FormData` is unverified on the static tier while JSON-string and `Uint8Array` bodies are verified?

## Answer

**Rest** owns a small RFC 7578 encoder that builds one `Uint8Array` and sends it with `fetch` on the LLVM Rest HTTP adapter. The header is a record: `Content-Type: multipart/form-data; boundary=…`. Callers pass **outbound file** values `{ filename, bytes, contentType? }`. JSON-shaped upload routes put the rest of the **outbound model** in a `payload_json` part; form-only routes use the field names Discord documents. `FormData`, C FFI, `ReadableStream` bodies, and a fourth gated performance scenario are out.

Cut 3 stays JSON-only ([1.0 completeness](./1.0-completeness-and-0.x-milestones.md)). This encoding is the cut-4 / 1.0 upload path.

## Why not FormData, FFI, or streams

| Path | Status on 0.0.36 | Why it is not 1.0 |
| --- | --- | --- |
| `FormData` | **BLOCKED** (`SC0001` Cannot find name `FormData`) | Waiting on a compiler lowering would stall the 1.0 upload promise. |
| `fetch` + JSON `string` | **VERIFIED-RUNTIME** (baseline) | No files. |
| `fetch` + `Uint8Array` + record `Content-Type` including `boundary` | **VERIFIED-RUNTIME** (loopback probe 2026-09-06) | Chosen vehicle. LLVM, `Content-Length` set, `payload_json` and `files[0]` received. |
| `ReadableStream` body | Loopback works only with `duplex: "half"`; **no** `Content-Length` | Chunked POST against Discord is **UNVERIFIED**. Extra `duplex` surface. |
| C FFI encoder | Unused | Rest stays LLVM; FFI is the Gateway-shaped escape, not a second REST lane. |
| npm form-data / undici | Policy **BLOCKED** | `--dynamic` / island. |

Probe sources lived under `/tmp/scriptc-probes-issue14` (not in git): `scriptc coverage` 32/32 static, `scriptc build --backend llvm`, loopback `node:http` printed `ct:multipart/form-data; boundary=----moonprobe cl:228 payload_json:true files0:true`.

## Public shape

An **outbound file** is a closed caller-built struct:

```ts
type OutboundFile = {
  filename: string;
  bytes: Uint8Array;
  contentType?: string;
};
```

No `fs` paths, streams, `Blob`, or `FormData`. Applications that have a path use `fs` themselves.

On typed Rest methods that document uploads, `files?` sits on the same **outbound model** as the JSON fields. Rest **removes** `files` before `JSON.stringify`. Empty or omitted `files` keeps `Content-Type: application/json` (cut-3 behavior).

**Rest hatch:** `execute({ method, path, query?, body?, files?, auditReason? })`. `body` remains JSON (`unknown`). `files` is a sibling array of **outbound file**s, never nested inside `body`. With `files` present, the hatch always encodes `payload_json` + `files[n]`. Named form fields (Create Guild Sticker `name` / `file`, …) exist only on the typed methods that Discord documents as form params.

## Wire layout (Rest-internal)

Encoder is **Rest** implementation, not a public module and not **Decode**. Tests observe the body through the Rest HTTP adapter (`createTestClient` scripted HTTP). No `moon-discord/multipart` export.

**JSON-shaped routes** (Create/Edit Message, Execute/Edit Webhook, Create Interaction Response, and other `files[n]` callback/followup routes):

1. Part `payload_json`: `Content-Disposition: form-data; name="payload_json"`, `Content-Type: application/json`, body = JSON of the outbound model without `files`.
2. For each **outbound file** in array order: part name `files[0]`, `files[1]`, … `Content-Disposition` includes `filename`. Part `Content-Type` is set only when `contentType` is present; Rest does not invent `application/octet-stream`.
3. `n` is that array index. Callers who fill Discord `attachments[].id` use `"0"`, `"1"`, … matching that order. The **outbound file** has no `n` field.

**Form-only routes** (Create Guild Sticker and any other 1.0 method whose resource page lists form fields rather than a JSON body): one part per documented name (`name`, `description`, `tags`, `file`, …). No `payload_json`. The file field uses the documented name (`file`, not `files[n]`).

Framing: CRLF between headers and bodies; closing delimiter `--boundary--`. File `bytes` are copied as opaque octets (not UTF-8 text). Boundary is an opaque token from `randomBytes` (static-tier **VERIFIED**). If the token appears in the assembled headers or body, regenerate, at most eight attempts; then fail without HTTP.

## Failures

Encode runs **before** Rest HTTP. It is configuration misuse, not Discord I/O ([failure note](./failure-cancellation-and-backpressure.md)):

- Empty or missing `filename`
- Missing `bytes`
- Form-only method invoked without the required file part
- Boundary still colliding after the retry cap

Those throw `ConfigurationError`. No `MultipartError` class.

Rest does **not** locally enforce Discord’s default 20 MiB (or Nitro/Boost / interaction `attachment_size_limit`). Oversized uploads fail as `DiscordHttpError` when Discord says so.

## Performance

The gated Rest **hot path** remains JSON-only `createMessage` ([performance contract](./performance-contract.md)). Multipart encode/dispatch is **not** a median/p95 scenario. Ticket 13 may add a non-budget encode smoke (small **outbound file**, scripted HTTP).

## Explicit non-decisions

- `application/x-www-form-urlencoded` (Discord allows it; 1.0 Rest stays JSON or this multipart).
- Live Discord upload smoke in CI (ticket 13).
- Later scriptc `FormData` lowering — do not switch the production encoder without a new decision.

## Primary sources

- Discord, [API reference — file uploads / `files[n]` / `payload_json`](https://docs.discord.com/developers/reference)
- Discord, [Message resource](https://docs.discord.com/developers/resources/message) (Create/Edit Message multipart)
- Discord, [Sticker resource](https://docs.discord.com/developers/resources/sticker) (Create Guild Sticker form params)
- Discord, [Receiving and responding](https://docs.discord.com/developers/interactions/receiving-and-responding) (interaction callback multipart)
- IETF, [RFC 7578](https://datatracker.ietf.org/doc/html/rfc7578) (`multipart/form-data`)
- scriptc 0.0.36 probes: [capability baseline](./scriptc-static-capability-baseline.md) (`FormData` SC0001; `Uint8Array` body); issue-14 loopback LLVM multipart POST (2026-09-06)
