# scriptc platforms

Source: [scriptc.dev/platforms](https://scriptc.dev/platforms).

## Host artifacts

`--emit=ir|c|llvm` — Node only. `--emit=asm|obj` — bundled LLVM helper on supported hosts (macOS arm64/x64 artifacts for macOS 14.0, helper needs macOS 15+; Linux glibc/musl x64/arm64; Windows x64 MSVC; WASI P1). Objects are not libraries: undefined `scr_*` plus `scr_runtime_abi_v1`.

Ordinary LLVM-tier **executables** need the platform linker and SDK/sysroot. Helper + precompiled runtime pack; the driver does not compile program or runtime C. Explicit C, LLVM fallback, and `--sanitize` still need a C compiler.

Primary host: macOS arm64. Leave `SCRIPTC_CC` unset there for the helper/runtime-pack route.

## Cross via zig

```console
$ SCRIPTC_CC=zigcc SCRIPTC_TARGET=aarch64-linux-gnu.2.36 scriptc build fib.ts -o fib-linux
$ SCRIPTC_CC=zigcc SCRIPTC_TARGET=x86_64-linux-gnu.2.36 scriptc build fib.ts -o fib-linux-x64
$ SCRIPTC_CC=zigcc SCRIPTC_TARGET=aarch64-linux-musl scriptc build fib.ts -o fib-alpine
$ SCRIPTC_CC=zigcc SCRIPTC_TARGET=x86_64-windows-gnu scriptc build fib.ts -o fib.exe
$ SCRIPTC_CC=zigcc SCRIPTC_TARGET=wasm32-wasi scriptc build hello.ts -o hello.wasm
```

GNU/Linux triples include a glibc version. musl builds are statically linked. `--sanitize` is a host-build lane.

## WASI Preview 1

Production LLVM target: same language tiers as native, including async, timers, stdin/readline, fs callbacks/promises, `--dynamic`. WASI P1 has no portable sockets, spawn, signals, net interfaces, or fs notifications — those APIs fail **before link** with SC3002 (`fetch`/net, `child_process`, signals, `os.networkInterfaces()`, `fs.watch`). Also unavailable: `--sanitize`, native FFI, `--lib`.

`scriptc run` hosts via Node WASI: cwd preopened as `/`, host temp as guest `/tmp`. Explicit `--backend c` is async-free inspection only; coroutine programs get SC3001. No silent C fallback.

## Mobile library mode

Standalone exe on these triples is SC3002. Use `scriptc build --lib --profile <file>`:

| Triple | Archive | Needs |
| --- | --- | --- |
| `aarch64-apple-ios` | Mach-O arm64, iOS 15+ | macOS + iPhoneOS SDK |
| `aarch64-apple-ios-simulator` | simulator arm64 | macOS + iPhoneSimulator SDK |
| `aarch64-linux-android` | ELF arm64, API 26+ | NDK (`ANDROID_NDK_ROOT` or newest NDK under `ANDROID_HOME`) |

`wasm32-wasi` also rejects `--lib` (SC3002).
