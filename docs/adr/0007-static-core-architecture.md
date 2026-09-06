# Four internal modules; `./rest` keeps LLVM off `tls.connect`

The public **Client** stays the only application seam. Behind it, **Rest**, **Decode**, **Session** (JSON Gateway machine per **Shard**), and **Gateway transport** (RFC 6455 over `tls.connect`) are the deep modules. Real adapters are Rest HTTP, text Gateway connection, and Clock — not `ClientOptions`, not **Decode**, not crypto, not cache. Package export `moon-discord/rest` is the LLVM graph; `"."` is the Gateway graph; `moon-discord/testing` constructs a **Client** with test adapters.

**Considered options:** merge Decode into Rest and framing into Session; inject HTTP/TLS/Clock/crypto ports on a public factory; hide transport behind `import()` or a `moon-discord/gateway` linker on the default import. Those either poison REST `--backend llvm`, make every bot an adapter assembler, or rest on unverified scriptc DCE.

**Consequences:** `static-contract.json` REST entries import `moon-discord/rest`; Gateway entries import `moon-discord`. `connect()` and **Gateway send** on the Rest export are configuration errors. **Cache** hooks inside **Client** after **Decode** as an optional policy, not a public port ([Choose the optional cache boundary](https://github.com/Ermianr/moon-discord/issues/11)). Detail: `docs/research/static-core-architecture.md`.
