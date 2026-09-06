# Performance contract

**Issue:** [Set the performance contract](https://github.com/Ermianr/moon-discord/issues/10)  
**Decision date:** 2026-09-06  
**ADR:** `docs/adr/0008-performance-contract.md`

## Question

Which benchmark scenarios, datasets, measurements, baselines, noise controls, and regression thresholds should block changes to **Decode**, heartbeat, and **REST dispatch**?

## Answer

Three gated **hot path** scenarios, compiled as scriptc static-tier ELFs on the same lanes as the product: **Decode** and **REST dispatch** with `--backend llvm` on the `moon-discord/rest` graph; Session heartbeat with the default backend on the Gateway graph. Numbers come from library work only (test adapters, no Discord network, no RFC 6455/TLS). Budgets are median and p95 against a git-recorded baseline from the first green `linux-x86_64-glibc` run for that scenario. A PR that touches a hot path fails if either aggregated percentile is **>10%** worse than that baseline. Node unofficial timings, peer libraries, and invented absolute SLAs are not the contract.

CI YAML, path filters, and when each scenario starts running in the 0.x cuts remain [Choose the delivery sequence and release gates](https://github.com/Ermianr/moon-discord/issues/13). This note is the *what* and *fail/pass rule*; ticket 13 is the *when* and *how the job is invoked*.

## What is gated

| Scenario | Module seam | Lane | Isolated unit |
| --- | --- | --- | --- |
| Decode | **Decode** (`unknown` → **inbound model**) | LLVM, `./rest` graph | Copy-decode of a fixture already parsed to `unknown`. `JSON.parse` is outside the timer. |
| REST dispatch | **Rest** through the Rest HTTP adapter | LLVM, `./rest` graph | Typed `createMessage` JSON-only: auth, User-Agent, **Bucket** remaining, serialize, adapter call. Adapter resolves immediately. Response **Decode** is not in this timer. |
| Heartbeat | **Session** through Gateway connection `sendText` | Default backend, `"."` graph | Session already live; **Clock** deadline fires; timer runs until Heartbeat (op 1) JSON is handed to `sendText`. |

Gating benches live in the repo, import those deep modules the same way in-repo tests will, and are **not** npm exports. They are development programs: they must still compile on the static tier without `--dynamic`. They are not `static-contract.json` consumer entries.

**Client** is not the gating seam. A non-gating smoke may pump one `MESSAGE_CREATE` through `createTestClient` to `on("MESSAGE_CREATE")` with **no** budget. Ticket 13 decides whether CI runs that smoke.

Cache stays off (today’s no-op collaborator; later, still off for these benches) so optional cache cannot enter the budget ([Choose the optional cache boundary](https://github.com/Ermianr/moon-discord/issues/11)).

## Decode datasets

Versioned JSON fixtures in git, official-shaped, with extra keys so drop-on-copy is measured. Not live Discord. Not **unknown dispatch**.

1. Steady-state: guild `MESSAGE_CREATE` (typical message, not an embed forest).
2. Large inbound: `READY` or `GUILD_CREATE`.
3. Rest list body: several messages (covers Rest **Decode**, distinct from a Gateway envelope).

## REST dispatch dataset

One uncontended `createMessage` JSON-only. **Bucket** has remaining. No 429 wait, no global 50 rps delay, no multipart ([Choose a static-tier encoding for Discord multipart REST](https://github.com/Ermianr/moon-discord/issues/14)). Rate-limit waiting is **Clock** policy, not dispatch.

## Heartbeat dataset

One periodic due Heartbeat on a live **Session**. Discord-initiated op 1, zombie ACK close, Hello jitter, and `heartbeat_interval` wall time are protocol correctness ([Define Gateway lifecycle and sharding semantics](https://github.com/Ermianr/moon-discord/issues/9)), not this budget.

## Metrics and baseline

Primary metrics: wall time of the isolated unit, **median** and **p95**, in microseconds. Throughput may be derived; it is not the gate. Allocations, RSS, and ELF size are not gated (scriptc has no trusted alloc counter; size is not this ticket).

Baseline: the first green, reproducible run of that scenario on `linux-x86_64-glibc` with the pinned scriptc version. Stored as versioned JSON in git, keyed by scenario + compiler + lane. No absolute µs figures in the ADR. Improving numbers do not rewrite the file silently; a baseline edit is an explicit, reviewable change.

Until a cut has landed the path and recorded that file, that scenario cannot fail a PR (there is nothing to compare). Ticket 13 binds recording to the 0.x cut that first ships the path (cut 1: Decode + REST dispatch; cut 2: heartbeat).

## Noise and regression

- Discard warmup.
- Many in-process iterations, then **K ≥ 3** separate processes.
- Compare the **median across processes** of (in-process median) and of (in-process p95).
- If the coefficient of variation of those process-level values exceeds **5%**, the run is **invalid**: retry; do not pass; do not rewrite the baseline.
- Hardware/OS/compiler match the [packaging static contract](https://github.com/Ermianr/moon-discord/issues/6): `linux-x86_64-glibc`, scriptc pin, no `--dynamic`.

**Fail** if either aggregated median or aggregated p95 is **>10%** relative above the baseline.

A PR **blocks** when its diff touches **Decode**, Rest dispatch, Session heartbeat, or their fixtures/benches. Unrelated docs/skills PRs do not take this gate. How CI detects “touches the hot path” is ticket 13.

## What this ticket does not decide

- Workflow YAML, path filters, changelog, and SemVer tag numbers (ticket 13).
- Failure/backpressure types (ticket 12).
- Multipart Rest dispatch as a later gated scenario (encoding: ticket 14; revisit after that lands).
- Gateway **transport** CPU (RFC 6455, `tls.connect` C-fallback). The product **hot path** list is Decode, heartbeat emit, and REST dispatch. Characterizing C-fallback sockets stays the [scriptc baseline](./scriptc-static-capability-baseline.md) caveat and map fog (later LLVM `tls.connect`), not a fourth gate here.
- Observability APIs (map fog).

## Considered options

| Design | Keep | Drop |
| --- | --- | --- |
| Node unofficial + scriptc, or Node-first until C-fallback is characterized | Scriptc lanes | Node is not the artifact; mixing C-fallback into REST LLVM numbers |
| Gate only through **Client** | Non-gating Client smoke | Handler fan-in in the budget; **Client** interface should not grow percentiles |
| Include `JSON.parse`, live `fetch`, framing, or Discord interval in the timer | Isolation via existing adapters + **Clock** | Protocol SLAs and UNVERIFIED timer/TLS noise |
| Invented absolute SLAs or twilight/discord.js comparison | Own git baseline | No binary yet; peer comparison is out of the map |
| Every PR runs all three scenarios; or gates only on public tags | Path-touching PRs | Docs PRs paying ELF cost; tags-only lets regressions land |
| One `MESSAGE_CREATE` decode fixture only; or one fixture per official `t` | Three Decode shapes | Too thin vs a correctness catalog |
| Hatch + GET + 429/50 rps in REST dispatch; inbound Heartbeat + full Hello wait | Uncontended `createMessage`; due Session Heartbeat | Mixes backpressure and protocol waits into dispatch/heartbeat CPU |
| Alloc/RSS gates; 5% or 20% relative threshold; auto-update baseline on improvement | Median+p95, 10%, explicit baseline edits | Profiler that does not exist; 5% fights CV; silent baseline drift |
