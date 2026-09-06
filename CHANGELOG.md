# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Client `connect` / `disconnect` / `closed` Gateway lifetime, Discord `t` dispatch via `on`, and `onUnknownDispatch`.

## [0.2.0] - unreleased

### Added

- Gateway representative imports `moon-discord` and compiles on the default backend with no `--dynamic`; the only accepted C-fallback is `tls.connect` / `tls.connectCb`.
- PR and tag CI cover both static-contract entries and run a non-budget `createTestClient` `MESSAGE_CREATE` smoke.
- Session heartbeat hot-path ELF baseline (median and p95) on the default Gateway lane.

## [0.4.0] - unreleased

### Added

- Sharded guild-bot representative with attachments compiles on the Gateway default backend and the REST LLVM lane, with no `--dynamic`.
- PR and tag CI run a non-budget multipart encode smoke when Rest multipart encoding is touched.

## [0.1.0] - unreleased

### Added

- Static REST transport: `moon-discord/rest` compiles on scriptc 0.0.36 with `--backend llvm` and no `--dynamic`.
- User-Agent, Bot authentication, JSON bodies, rate-limit buckets, Rest hatch, and Get Gateway / Get Gateway Bot.
- Decode and REST dispatch hot-path ELF baselines (median and p95) on the LLVM rest lane.
