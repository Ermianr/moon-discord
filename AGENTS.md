# Agent instructions

## Product pillars

Three constraints on every library change:

1. **Static** — ship a **compiled** scriptc artifact. Gateway, Rest, and decode stay on the static tier; `--dynamic` there is a regression.
2. **Hot path** — **performance** is a requirement on decode, heartbeat, and REST dispatch, not a later pass.
3. **DX** — a small, comfortable `Client`; session, buckets, and transport stay behind it.

## Source language

Write every artifact that lands in the repo in **English**: identifiers (files, directories, variables, functions, types, CLI flags), comments, commit messages, documentation, skills, and this file.

## Agent skills

### Issue tracker

Issues and specs are tracked in GitHub Issues using the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The canonical default triage label vocabulary is used. See `docs/agents/triage-labels.md`.

### Domain docs

This repository uses a single-context domain documentation layout. See `docs/agents/domain.md`.

