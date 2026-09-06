# Four public 0.x tags, then 1.0 as a promotion; CI never hits Discord

Public delivery is `0.1.0` (REST) → `0.2.0` (Gateway) → `0.3.0` (JSON guild-bot) → `0.4.0` (1.0 capability) → `1.0.0` (same capability, stability checklist; may be the same commit as `0.4.0`). npm starts at `0.1.0`. `CHANGELOG.md` records `0.x` breaks; patches stay inside a cut. PRs on `linux-x86_64-glibc` run Node protocol tests, `scriptc coverage` without `--dynamic` on the **static contract** entries that exist, and **hot path** ELF compares only when explicit Decode / Rest / Session (plus bench/fixture) paths change and a git baseline exists. CI uses fixtures and test adapters, not Discord. Maintainers tag `main`; the tag job attaches coverage and publishes npm.

**Considered options:** skip `0.4.0` and call cut 4 `1.0.0`; calendar soak; hold npm until 1.0; live Discord in CI; compile every test as a scriptc ELF; run benches on all `src/` PRs or only on tags; publish every `main` merge. Those either drop a public `0.x` cut, delay `--npm-static` evidence, make gates flaky, or let **hot path** regressions land.

**Consequences:** HTTP ingest / **Interaction signature** does not block `1.0.0`. Multipart lands in cut 4. Node remains unofficial. Detail: `docs/research/delivery-sequence-and-release-gates.md`.
