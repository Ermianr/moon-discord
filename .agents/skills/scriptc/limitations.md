# scriptc limitations

Source: [scriptc.dev/limitations](https://scriptc.dev/limitations). `scriptc coverage` on the actual entry file is authoritative for that program.

## Rejected at compile time (tour)

Language

- Coercing `==`/`!=` except number/string/boolean pairs and `== null` / `!= null`.
- `break`/`continue` across `finally`; any `return`/`break`/`continue` *out of* a `finally` body. Ordinary `return` *through* `finally` compiles.
- Generic edges: nested generic functions, generic class expressions, generic classes whose base depends on own type params, generic methods needing dynamic dispatch, unpinned generic function values, rebound generic bindings.
- Built-in call-only lowerings: do not take `Math.floor` (etc.) as a value.

Types

- Exact record structs; extra fields are SC2002. Accepted field-subset flows *copy* the record.
- Union used whole where a per-arm answer is required (`u.length` on `string | string[]` — narrow first).
- Tuple inference from `Promise.all([a, b])` then tuple methods (e.g. `.join`) — type as `T[]` first.
- `any`/`unknown` on locals, params, returns — not class fields, array elements, or union arms (record/tuple fields may hold `unknown`).
- Operations on `unknown` beyond truthiness, `typeof` narrowing, property access, `+`, `switch`, `throw` need a checked cast.

Stdlib

- Full `es2025` (+ `@types/node` when present) is visible to the checker; unlowered members are SC2020 with alternatives in the hint (`re.exec`, `Symbol`, `globalThis`, many Array/Map/Set methods, `console.table` / `console.time`, …).
- `Date`: zero-arg, one number/string arg, `getTime`/`valueOf`/`toISOString`, local/UTC getters, `getTimezoneOffset`. Setters, `Date.parse`, locale formatters, identity comparisons, date-armed unions remain fenced.
- Map/Set keys: strings and numbers.

scriptc's type world differs in places (`JSON.parse` → `unknown`, `pop()` → `T`, Promise reject reason pinned to `Error`). A program clean under project `tsc` can still hit per-site scriptc diagnostics (second-chance preflight + rewrite hints), never a bare unexplainable type error.

## Divergences (static tier otherwise matches Node I/O)

- Dense arrays: invalid index / empty `pop` abort with a trap; not catchable. User `throw`, JSON/cast/fs/regex errors remain catchable.
- Lying checked casts throw with a path (`expected number at $.port, got string`).
- Structural width and island crossings copy; no aliasing.
- `Object.keys`/`values`/`entries` and `JSON.stringify` use declaration order, not insertion order.
- Strings stored UTF-8; `.length` and methods are UTF-16-exact except `<`/`>` (code-point order) and surrogate-splitting (U+FFFD).
- `process.argv[0]` is `"scriptc"`; `argv[1]` is the binary path.
- Uncaught stderr is `Uncaught <message>` rather than Node's stack block; exit code and pre-throw stdout still match.
- Runtime errors: `message` and Node `code`, not `errno`/`syscall`/`path`.
- `sort`/`toSorted` use stable insertion sort (results match for consistent comparators).
- `localeCompare` is code units, not ICU.
- Memory is RC + deterministic cycle collection. Cycles that cross static/island are uncollectable.

## Dynamic island

- quickjs-ng, not V8 — size/startup win, not CPU throughput for dependency code.
- Builtin shims inside the engine, named in `coverage --dynamic`.
- Static fibers drain first; engine jobs at loop quiescence — interleaving can differ from Node.
- Top-level `await` in island ESM packages is unsupported; it does compile in the program's own ESM graph and in `--npm-static` packages.
- Class instances and promises cannot flow into `any` slots; some closure shapes only. Refusals are compile errors.

## WASI / FFI / numbers

See [platforms.md](platforms.md) and [ffi.md](ffi.md). Numbers are JS-exact f64 everywhere; integer inference is not shipped.
