# Own a TypeScript Ed25519 verify behind handleInteractionRequest

scriptc 0.0.36 has no static signatures, HMAC, or WebCrypto, and `Float64Array` does not lower, so HTTP Interactions Endpoint URL verification cannot use `node:crypto` or stock tweetnacl. moon-discord owns a verify-only Ed25519 port (`number[]` / `Uint8Array`) in the Rest graph behind `handleInteractionRequest`: raw body string, constructor `publicKey`, 401 returned (not thrown) on failure. FFI, npm crypto, and a verify **Adapter** were rejected so `--npm-static moon-discord` and LLVM REST stay one lane. HTTP ingest remains 1.x completeness; a later compiler lowering replaces the port internally.

**Considered options:** wait for scriptc; `--ffi` libsodium; `--dynamic` tweetnacl; caller-supplied verify; keep parsed `unknown` bodies. Those stall 1.x, add consumer native flags, violate the static bar, leak the **Client**, or break Discord’s signed string.

**Consequences:** `handleInteractionRequest({ body: string, headers })` verifies then **Decode**s. `moon-discord/testing` may sign fixtures; production exports do not. Detail: `docs/research/http-interaction-signature-verify.md`.
