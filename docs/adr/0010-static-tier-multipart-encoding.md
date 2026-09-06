# Hand-rolled Uint8Array multipart inside Rest; no FormData

`FormData` is absent on scriptc 0.0.36 (`SC0001`), but `fetch` already accepts `Uint8Array` bodies on the LLVM Rest lane. 1.0 therefore encodes Discord `multipart/form-data` in **Rest**: RFC 7578 bytes, record `Content-Type` with a `randomBytes` boundary, **outbound file** `{ filename, bytes, contentType? }` on typed methods and as a hatch sibling. JSON upload routes use `payload_json` + `files[n]`; form-only routes use Discord’s field names. Encode failures are `ConfigurationError` before HTTP. Multipart is not a gated **hot path**.

**Considered options:** wait for `FormData`; C FFI; `ReadableStream` + `duplex: "half"`; fs paths; a public encode module; a 20 MiB local cap; a fourth performance scenario. Those block 1.0 on the compiler, leave LLVM Rest, skip `Content-Length`, leak wire format, or measure buffer copies instead of JSON dispatch.

**Consequences:** cut 3 stays JSON-only; cut 4 implements this encoder. The Rest hatch gains `files?`. Detail: `docs/research/static-tier-multipart-encoding.md`.
