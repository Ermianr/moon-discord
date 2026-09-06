# Delivery sequence and release gates

**Issue:** [Choose the delivery sequence and release gates](https://github.com/Ermianr/moon-discord/issues/13)  
**Decision date:** 2026-09-06  
**ADR:** `docs/adr/0011-delivery-sequence-and-release-gates.md`  
**Cuts:** `docs/research/1.0-completeness-and-0.x-milestones.md`  
**Packaging:** `docs/research/packaging-and-artifact-contract.md`  
**Performance:** `docs/research/performance-contract.md`

## Question

Given all resolved product and architecture decisions, what ordered delivery sequence, static checks, protocol conformance tests, performance gates, and release criteria provide the shortest safe route to 1.0?

## Answer

Ship four public **capability cuts** as `0.1.0` … `0.4.0`, then promote cut 4 to `1.0.0` when packaging, **performance contract**, and failure gates are green — same capability, possibly the same commit. Publish `moon-discord` to npm from the first public tag. CI never talks to Discord. Protocol tests run on unofficial Node; `scriptc coverage` (no `--dynamic`) and scriptc ELF benches are the static and **hot path** doors. Tags are created on `main`; the tag job attaches coverage to the GitHub Release and publishes npm.

This note is the *when* and *how CI is invoked*. It does not reopen cut contents, compile lanes, bench math, or multipart encoding.

## SemVer

| Tag | Capability cut | `static-contract.json` entries |
| --- | --- | --- |
| `0.1.0` | 1. Static REST transport | REST-only (`moon-discord/rest`, `--backend llvm`) |
| `0.2.0` | 2. Gateway session | REST + Gateway (`"."`, default backend; only C-fallback `tls.connect` / `tls.connectCb`) |
| `0.3.0` | 3. Usable guild-bot (JSON-only) | Same two entries; coverage *content* grows |
| `0.4.0` | 4. Scale to 1.0 capability (sharding, remaining typed Dispatch/Rest, multipart) | Same two entries |
| `1.0.0` | No new surface: cut 4 plus the 1.0 checklist below | Unchanged shape |

Patches `0.N.P` fix the current cut without adding the next cut’s capability (a Bucket fix after `0.1.0` is `0.1.1`, not `0.2.0`). Do not skip a cut. After `1.0.0`, SemVer is strict (`1.0.x` patches, `1.x` minors). `0.x` may break if `CHANGELOG.md` says so.

A scriptc pin bump updates `static-contract.json` `compiler` and the changelog. If capability is unchanged it is a patch of the current cut.

`1.0.0` may be the same git commit as `0.4.0` when that commit already satisfies the 1.0 checklist. There is no calendar soak and no discord.js parity gate.

## Changelog and publish

- `CHANGELOG.md` (Keep a Changelog) in git, one section per public tag. The GitHub Release copies that section.
- First npm publish is `0.1.0`. Every later public tag publishes npm.
- Tags are annotated, from `main` only. The maintainer tags after the cut checklist. Pushing the tag runs release CI: coverage transcripts on the GitHub Release, `npm publish`, and recording a **performance contract** baseline file if this tag first ships a gated scenario. Do not `npm publish` from a dirty working tree.

## Engineering order

Work the cuts in tag order. Do not wait on [Choose how HTTP Interactions signatures verify on the static tier](https://github.com/Ermianr/moon-discord/issues/15) (`1.x`). Multipart encoding is already decided ([Choose a static-tier encoding for Discord multipart REST](https://github.com/Ermianr/moon-discord/issues/14)); implement it in cut 4, not cut 3.

Inside a cut, land in this order so gates have something to run:

1. Module + test adapters + protocol tests (Node).
2. Representative program + `static-contract.json` entry + `scriptc coverage`.
3. Gated bench + first baseline (cut 1: Decode and REST dispatch; cut 2: heartbeat), then path-filtered PR gating.

Optional cache is not a cut gate.

## Protocol tests (CI never uses Discord)

Authoritative inputs are official docs, versioned git fixtures, and scripted Rest HTTP / Gateway-connection / Clock adapters (`createTestClient` and in-repo tests). No bot token in CI. A maintainer live smoke is optional and is not a release door.

| Cut | Must be green to tag |
| --- | --- |
| 1 | User-Agent, Bot auth, JSON bodies, **Bucket** + global 50 rps via Clock, 429/5xx waits, **Rest hatch**, Get Gateway / Get Gateway Bot **Decode**. |
| 2 | Gateway transport framing (internal byte seam, not **Client**); Session Hello/Identify/Heartbeat/ACK/zombie close/Resume/Invalid Session/Reconnect/documented close codes; `connect()` completes on Ready/Resumed; **unknown dispatch** does not kill the Session. |
| 3 | Typed Rest + typed **Dispatch** for the guild-bot working set (JSON-only); `INTERACTION_CREATE` plus interaction callback/followup through Rest; application command CRUD; non-gating `createTestClient` `MESSAGE_CREATE` smoke. |
| 4 | Identify concurrency / shard plan; remaining official `t`; remaining 1.0 Rest including multipart encode ([static-tier multipart](./static-tier-multipart-encoding.md)); guild-admin typed methods in the 1.0 list. |

Node is unofficial: these tests are a behavior net, not the static promise. Do not require every test file to compile as a scriptc ELF.

## Static checks

Every PR (once the files exist), on `linux-x86_64-glibc`, pinned scriptc, **no** `--dynamic`:

1. Typecheck.
2. Protocol/unit tests on Node.
3. `scriptc coverage` on every `static-contract.json` `entries[]` path present on that branch, with that entry’s lane flags.
4. **Hot path** ELF benches when the diff matches the path filter **and** a baseline file for that scenario exists. Invalid (CV > 5%) is not green.
5. From cut 2: `createTestClient` smoke, no budget.
6. From cut 4: non-budget multipart encode smoke when the diff touches Rest multipart (not a fourth **hot path** scenario).

Sample-bot ELFs are optional GitHub Release extras, not a PR door.

Tag/release job: the same checks, then attach raw coverage output per entry, confirm `--dynamic` was absent, `npm publish`, write the first baseline JSON for any scenario this cut introduces.

Intended coverage commands (names follow [packaging](./packaging-and-artifact-contract.md); source paths live in git at the tag):

```console
scriptc coverage <rest-entry.ts> --backend llvm
scriptc coverage <gateway-entry.ts>
```

Consumer compile remains `scriptc build bot.ts --npm-static moon-discord` (Gateway bots omit `--backend llvm`).

## Performance gates (when and how)

Recording (from the **performance contract**): cut 1 writes Decode + REST dispatch baselines; cut 2 writes heartbeat. Until that file exists, the scenario cannot fail a PR.

**Path filter** (explicit prefixes; not “any `src/`”). A PR runs a scenario’s ELF compare only if it touches that scenario’s implementation, fixtures, or bench program:

| Scenario | Directories (create these names when the tree lands) |
| --- | --- |
| Decode | `src/decode/`, `benches/decode/`, `fixtures/decode/` |
| REST dispatch | `src/rest/`, `benches/rest-dispatch/`, `fixtures/rest-dispatch/` |
| Heartbeat | `src/session/`, `benches/heartbeat/`, `fixtures/heartbeat/` |

Docs, skills, and unrelated modules do not pay ELF cost. Fail/pass math stays in `docs/research/performance-contract.md` (median and p95, 10%, K ≥ 3, CV > 5% invalid).

## Per-tag checklist

Shared by every public tag: `CHANGELOG.md` section; tests + coverage green on `linux-x86_64-glibc`; `--dynamic` absent; GitHub Release coverage transcripts; npm tarball matches [packaging](./packaging-and-artifact-contract.md) (`static-contract.json`, JS+`.d.ts`+`src`).

| Tag | Extra |
| --- | --- |
| `0.1.0` | REST coverage entry; Decode + REST dispatch baselines recorded. |
| `0.2.0` | Gateway coverage entry; heartbeat baseline recorded. |
| `0.3.0` | Cut 3 protocol list; JSON-only (no multipart requirement). |
| `0.4.0` | Cut 4 protocol list; multipart encoder shipped. |
| `1.0.0` | All three baselines present and green; both contract entries; cut 4 capability; no open P0 protocol defects on a written checklist; HTTP ingest / **Interaction signature** does **not** block. |

## Explicit non-decisions

- Workflow YAML filenames and GitHub Actions syntax (implement against this note).
- npm trusted-publishing vs a CI token (either is fine if only the tag job publishes).
- Observability APIs, extra OS/arch, LLVM `tls.connect` (map fog).
- HTTP Interactions Endpoint URL **Interaction signature** is resolved for 1.x implementation: [Choose how HTTP Interactions signatures verify on the static tier](https://github.com/Ermianr/moon-discord/issues/15) (`docs/research/http-interaction-signature-verify.md`).

## Considered options

| Design | Keep | Drop |
| --- | --- | --- |
| `0.4.0` then `1.0.0` promotion vs tagging cut 4 only as `1.0.0` vs calendar soak | Four public `0.x` cuts from ticket 5; `1.0` as stability | Fifth feature dump; soak that the gates already cover |
| npm from `0.1.0` vs GitHub-only until `0.3`/`1.0` | Early `--npm-static` validation | Unchecked consumer compile until late |
| `CHANGELOG.md` vs Releases-only vs conventional-commit autogen | File in git with the tag | Undocumented `0.x` breaks |
| PR coverage+path benches vs ELF sample-bots every PR vs coverage only on tags | Static and **hot path** on the PR | Docs PRs paying sample ELFs; regressions landing before a tag |
| Fixtures+adapters vs live Discord in CI or on every tag | Reproducible protocol net | Tokens, flakes, non-static network |
| Explicit bench path prefixes vs all of `src/` vs label skip | Ticket 10’s “touches the hot path” | Unrelated PRs compiling ELFs |
| Node tests + scriptc coverage/benches vs every test as ELF vs coverage-only | Fidelity on the promise surfaces | Slow LLVM of the whole suite; untested Rest/Session |
| Tag-from-`main` + tag CI publish vs local `npm publish` vs publish every `main` merge | Cut == tag == tarball | Dirty-tree publishes; untagged npm |
