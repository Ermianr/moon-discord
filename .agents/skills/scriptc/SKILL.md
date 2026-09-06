---
name: scriptc
description: Compile TypeScript/JavaScript with scriptc to native binaries, LLVM IR, C, objects, or WASI. Use when the user mentions scriptc, TypeScript-to-native, --dynamic, scriptc coverage, SC diagnostics, native FFI manifests, or compiling TS without Node/V8.
---

# scriptc

scriptc ([vercel-labs/scriptc](https://github.com/vercel-labs/scriptc), docs at [scriptc.dev](https://scriptc.dev)) compiles ordinary TypeScript/JavaScript with the real TypeScript compiler, then lowers to typed IR → LLVM (default) or readable C → native executable or WASI. Static binaries carry a small native runtime, not Node or V8.

The project is experimental. Prefer `scriptc --help` and [scriptc.dev/cli](https://scriptc.dev/cli) for flag completeness; this skill is the decision surface.

## Three tiers

Every construct lands in exactly one tier. The tier is the promise.

1. **Static** — native code, no engine. Default. Byte-identical stdout/stderr/exit vs Node except [numbered divergences](limitations.md).
2. **Dynamic** — opt in with `--dynamic`. Embeds quickjs-ng (~620KB) for npm shipped JS and `any`-typed code. Values cross the boundary by copy; dynamic→static edges are validated (`TypeError`, not memory corruption).
3. **Rejected** — compile error with an `SC` code, a code frame, and usually a rewrite hint. Nothing is silently miscompiled.

A binary never grows an engine unless `--dynamic` is passed.

## Workflow

Copy and track:

```
- [ ] Typecheck gate: program must typecheck (scriptc honors nearest tsconfig)
- [ ] scriptc coverage <entry> — assign every site to a tier
- [ ] Rewrite blockers (SC codes) or opt into --dynamic only if coverage names island sites
- [ ] scriptc build (or run) with the matching flags
- [ ] Verify: dense arrays, argv, checked casts — see limitations.md
```

**Coverage first.** `scriptc coverage` analyzes without building. Type errors abort analysis; fix those first.

```console
$ scriptc coverage app.ts
$ scriptc coverage app.ts --dynamic
```

- Without `--dynamic`: `runs with --dynamic` sites are per-site errors on a static build (often SC2013 for npm).
- With `--dynamic`: remaining **blockers** still fail the build; `--dynamic` does not erase the rejected tier.
- Island Node builtins show as shimmed vs unshimmed; an unshimmed builtin is reported, never silently stubbed.

**Then compile.**

```console
$ npm install -g scriptc          # Node ≥ 24 to run the compiler
$ scriptc run hello.ts            # compile + execute; does not forward extra argv
$ scriptc build hello.ts -o hello # pass program args on the binary, not via run
$ ./hello ada
```

`--emit=ir|c|llvm` needs only Node. `--emit=asm|obj` uses the bundled helper (no clang). `--emit=exe` (default) needs a platform linker/SDK for ordinary LLVM-tier builds; generated/runtime C is not compiled on that path. Artifacts without `-o` land in `.scriptc/`.

### Escape hatches

- `--dynamic` — npm packages and `any`. Package JS is embedded at build time; the binary does not read `node_modules` at runtime.
- Checked `as` — `JSON.parse(...) as Config` is a runtime validation naming the JSON path on mismatch.
- `comptime(() => ...)` — runs TypeScript in an isolated compiler VM; result is baked as a literal.
- `--npm-static` / `--provenance-sources` — experimental; preflight can fall back to the island. Read coverage notes.
- `--sanitize` — ASan + refcount audit (host builds). Rejected for `--emit=asm|obj` until helper sanitizer parity.
- `--backend llvm` — pin LLVM; SC3001 instead of silent C fallback. WASI never falls back.

## Write TypeScript that survives static

No dialect, no annotations, no special stdlib. Still treat these as load-bearing:

**Dense arrays.** Out-of-bounds reads and `pop()` on empty trap (`RangeError`) and abort; they are not `undefined` and are not catchable.

```ts
const who = process.argv.length > 2 ? process.argv[2] : "world";
```

**Prefer `unknown` + checked cast** over `any`. Bare `any` without `--dynamic` is SC2011.

**Narrow unions before member access.** Record shapes are exact structs (extra fields → SC2002). Type `Promise.all` inputs as arrays when tuple methods would fence.

**Call stdlib functions directly.** `const g = Math.floor` is often fenced; `Math.floor(x)` compiles.

**Use `===` / `!==`.** Loose `==`/`!=` only for number-number, string-string, boolean-boolean, and `== null` / `!= null`.

Static Node surface includes `fs` (sync + promises), `path`, `process`, `child_process`, `os`, `crypto`, `url`/`URL`, `zlib`, timers/signals, `net`/`http`/`https`/`tls`/`dgram`/`dns`/`readline`, and native `fetch` (use `Response.bytes()` where `arrayBuffer()` is SC2020).

## Diagnose SC codes from coverage, not folklore

| Code | Typical meaning |
| --- | --- |
| SC2013 | npm implementation needs the island — pass `--dynamic` or drop the import |
| SC2011 | `any` without `--dynamic` |
| SC2020 | typed stdlib member with no lowering — hint lists alternatives |
| SC2002 | extra record fields where an exact shape is required |
| SC1100 | `unknown` flowing where `any` is expected |
| SC1010 | embedder-only module (coverage `--external-types` types it; builds still need a real module) |
| SC3001 | missing LLVM lowering (pinned `--backend llvm`, or WASI) |
| SC3002 | target cannot host this API or mode (WASI sockets, `--lib` on WASI, exe on iOS/Android, …) |
| SC5xxx | FFI manifest / ABI mismatch |

If coverage and `build` disagree, trust the compiler on that program; docs lag.

## Tooling rules

- `scriptc run` does not forward extra CLI arguments. Build, then invoke the binary.
- `SCRIPTC_CC=zigcc` + `SCRIPTC_TARGET=<triple>` for cross and WASI. On macOS arm64, leave `SCRIPTC_CC` unset for the bundled helper/runtime-pack executable path; `SCRIPTC_CC=clang|zigcc` is a deprecated executable route.
- `SCRIPTC_LINKER` selects the platform linker driver for ordinary LLVM-tier executables.
- `--print=native-link-info` emits `--emit=obj` plus a versioned JSON link recipe (experimental object ABI; exact runtime version).
- `--lib` is embedder archives (mobile), not `--emit=obj`. Objects keep undefined `scr_*` symbols plus `scr_runtime_abi_v1`.

## Branching

- **Fences and Node divergences** → [limitations.md](limitations.md)
- **Outbound C ABI (`--ffi`)** → [ffi.md](ffi.md)
- **Host, zig triples, WASI, iOS/Android `--lib`** → [platforms.md](platforms.md)
- **Working inside github.com/vercel-labs/scriptc** → [contribute.md](contribute.md)

Live docs: [quickstart](https://scriptc.dev/quickstart), [CLI](https://scriptc.dev/cli), [coverage](https://scriptc.dev/coverage), [dependencies](https://scriptc.dev/dependencies), [how it works](https://scriptc.dev/how-it-works).
