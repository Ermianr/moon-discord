# Contributing to vercel-labs/scriptc

Apply this file only when the workspace **is** the [scriptc](https://github.com/vercel-labs/scriptc) compiler repo. Consumer compile workflows stay in [SKILL.md](SKILL.md). Canonical agent rules: repo `AGENTS.md`.

## Layout

| Path | Role |
| --- | --- |
| `packages/compiler` | tsc → IR, validator, LLVM/C backends, coverage |
| `native/llvm-codegen` | LLVM 22 sidecar |
| `packages/runtime` | RC runtime, fibers, event loop, server stack, island glue |
| `packages/runtime-*` | precompiled runtime packs |
| `packages/cli` | `build` / `run` / `coverage` |
| `internal/compatibility` | Node parity inventory (static vs island are independent) |
| `tests/` | differential corpus, diagnostics snapshots, harness |
| `docs/` | Next.js + MDX site (`docs/src/app/<slug>/page.mdx`) |

## Gates

```bash
pnpm install && pnpm -r build
pnpm test:sandbox    # preferred full gate (Vercel Sandbox; VERCEL_OIDC_TOKEN)
```

Ordinary `pnpm -r build` does not rebuild packaged native artifacts. Native helper/runtime pack changes need CMake, Ninja, pinned LLVM 22, then the matching `@scriptc/llvm-*` / `@scriptc/runtime-*` `build:native` scripts.

Corpus programs are differential: Node vs compiled binary; stdout, stderr, exit must match byte-for-byte. New behavior lands with corpus programs both ways. Co-locate unit tests (`foo.ts` → `foo.test.ts` under `packages/*/src`); package API tests in `packages/*/test`; cross-package e2e in `tests/`.

## Compatibility inventory

Never hand-edit generated files (`packages/compiler/surface-manifest.json`, `internal/compatibility/generated/*`, `docs/src/generated/node-v24-compatibility*.json`, `packages/runtime/src/scr_island_manifest.h`). Change sources, then `pnpm manifest` and/or `pnpm node-compat`.

`supported` / `partial` require test evidence. Do not flip a status to pretty-up the public matrix. Static-native support does not imply island support. `pnpm node-compat:backlog` emits actions (`verify-gap` before assuming code is missing).

## Docs

Project name is **scriptc**, lowercase. Coverage numbers must be real `scriptc coverage` output for a program shown in the same block. Shell fences must have been run. Limitations live on the limitations page, not as scattered fine print. Docs CI: `cd docs && NEXT_DIST_DIR=.next-check pnpm check`.
