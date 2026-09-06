# Pin scriptc 0.0.36 and split REST/Gateway compile lanes

moon-discord's compile promise is the engine-free static tier with no `--dynamic` and no runtime npm graph. REST uses global `fetch` on the LLVM backend. Gateway cannot use a built-in `WebSocket` and instead owns RFC 6455 over `node:tls`; `tls.connect` is `SC3001` on LLVM, so Gateway binaries use scriptc's native C fallback until that lowering exists. Transport `zlib-stream` stays off because there is no streaming inflater. `any` and `bigint` stay out of production source even where a probe compiled.

**Considered options:** wait for LLVM `tls.connect`; use `--dynamic` plus `ws`; treat the surface manifest as blocking TLS. Those either delay the Gateway path, violate the product bar, or contradict the installed 0.0.36 compiler.

**Consequences:** pin scriptc 0.0.36 until the capability matrix is rerun; CI must assert LLVM for REST-only entries and accept only the known TLS C-fallback note on Gateway entries. HTTP Interactions Endpoint URL verification cannot assume `node:crypto` signatures, HMAC, or WebCrypto on this compiler.
