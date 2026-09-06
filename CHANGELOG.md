# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - unreleased

### Added

- Static REST transport: `moon-discord/rest` compiles on scriptc 0.0.36 with `--backend llvm` and no `--dynamic`.
- User-Agent, Bot authentication, JSON bodies, rate-limit buckets, Rest hatch, and Get Gateway / Get Gateway Bot.
- Decode and REST dispatch hot-path ELF baselines (median and p95) on the LLVM rest lane.
