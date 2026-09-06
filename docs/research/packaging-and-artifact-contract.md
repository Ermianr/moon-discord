# Packaging and artifact contract

**Issue:** [Choose the packaging and artifact contract](https://github.com/Ermianr/moon-discord/issues/6)  
**Decision date:** 2026-09-06  
**ADR:** `docs/adr/0005-packaging-and-artifact-contract.md`  
**Baseline:** `docs/research/scriptc-static-capability-baseline.md` (scriptc 0.0.36)

## Question

What source package, compiled fixtures, native artifacts, compatibility metadata, and verification evidence should a release publish so consumers can rely on the no-`--dynamic` promise?

## Answer

Publish **`moon-discord` on npm** as ESM: emitted JavaScript, `.d.ts`, and TypeScript source. Consumers write `import { Client } from "moon-discord"` and compile with **`scriptc build <bot> --npm-static moon-discord`**, never `--dynamic`. Node execution is not a product promise. Each public tag (first public `0.x` onward) attaches **`scriptc coverage` evidence** on the GitHub Release and ships a **`static-contract.json`** in the tarball that names the representative program entries and compile lanes. There is no published library ELF/`--lib` archive. Sample-bot ELFs are optional extras, not the contract.

Exact CI command lists and SemVer cut numbers stay with [Choose the delivery sequence and release gates](https://github.com/Ermianr/moon-discord/issues/13).

## Why npm is not static by default

scriptc 0.0.36 treats a package-name import as the dynamic island (**SC2013**), including a TypeScript-only package whose `exports` point at `.ts`. A relative import of the same `.ts` is fully static. `--npm-static <pkg>` compiles **shipped JavaScript** informed by that package’s `.d.ts`; a trivial JS+`.d.ts` package reached fully static coverage. `--npm-static` on TypeScript-only with no `.d.ts` failed in the same probe (`SC1010` / island fallback). `--npm-static` is experimental. ADR-0001 still forbids it as a substitute for **repository-owned** dependencies inside moon-discord; it is the **consumer** compile flag for this one package.

`--provenance-sources` is not the supported path. Releases **may** include npm provenance attestations when the pipeline can; that does not replace `--npm-static` until separately verified.

## npm package

| Field | Contract |
| --- | --- |
| Name | `moon-discord` (unscoped). Matches the public Client import. |
| Module | `"type": "module"`. No CommonJS dual publish. |
| Tarball | `dist/` JS + `.d.ts` (the `--npm-static` input), plus TypeScript `src/` for audit and a possible later provenance path. Tests, agent files, and prototypes stay out. |
| `exports` | `"."` → JS implementation + `types`. Do not export only `.ts` (breaks `--npm-static` on 0.0.36). |
| Runtime | scriptc static tier. **Node is unofficial**: JS in the tarball exists for `--npm-static`, not as a supported Node library. |

Documented consumer compile (Gateway bots cannot pin `--backend llvm`; see lanes below):

```console
scriptc build bot.ts --npm-static moon-discord
```

Vendoring the TypeScript via a relative import remains a valid escape if `--npm-static` breaks on a compiler bump; it is not the happy path.

## Static contract (in the tarball)

`static-contract.json` is the machine-readable promise. npm `engines` / `os` / `cpu` are insufficient (they cannot express `--npm-static` or the TLS C fallback). Minimum contents:

- `compiler`: pinned scriptc version (`0.0.36` until the capability matrix is rerun).
- `dynamic`: forbidden (`--dynamic` must not appear on consumer or CI compiles of representative programs).
- `npmStatic`: `["moon-discord"]`.
- `platform`: initial `linux-x86_64-glibc` (binaries remain dynamically linked to libc; “static tier” ≠ fully static ELF).
- `entries`: named representative **programs**, not the package. Each entry has a source path (in the **git tag**, not the npm tarball) and a lane:
  - **REST-only**: `scriptc coverage` fully static; build `--backend llvm`.
  - **Gateway** (once that `0.x` cut exists): default backend; the only accepted C-fallback note is `libCall:tls.connect` / `tls.connectCb`.

The REST-only public cut publishes only the REST entry. Adding Gateway adds the second entry. The **shape** of the contract does not change across `0.x` and `1.0`; coverage *content* grows with capability cuts ([Define 1.0 completeness and pre-1.0 milestones](https://github.com/Ermianr/moon-discord/issues/5)).

## GitHub Release evidence

Each public tag’s GitHub Release holds the verification evidence:

- Raw `scriptc coverage` output for every `entries[]` path at that tag, compiler version, and lane flags.
- Confirmation that `--dynamic` was not used.

Representative bot **source** lives in git at the tag; `static-contract.json` points at those paths. The npm tarball does not carry bots, IR, or C dumps. Prebuilt sample-bot ELFs may be attached as extras; consumers do not integrate by downloading a `.so` / `--lib` archive.

## What this ticket does not decide

- CI workflow YAML, changelog, and `0.1` / `0.2` / `1.0` tag numbers ([Choose the delivery sequence and release gates](https://github.com/Ermianr/moon-discord/issues/13)).
- Targets past linux x86_64 glibc (still map fog).
- Whether a later LLVM `tls.connect` lowering retires the Gateway C-fallback lane (still map fog).
- Internal module seams ([Choose the static core architecture](https://github.com/Ermianr/moon-discord/issues/7)).
