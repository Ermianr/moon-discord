# scriptc native FFI

Source: [scriptc.dev/ffi](https://scriptc.dev/ffi). Outbound C ABI only: signature-only `declare function`, JSON manifest, archives/objects at link. No `dlopen`/`dlsym`. Executable builds only — not `--lib`.

FFI binds a **direct call** of that exact declaration. A function with a body, overload, generic, alias (`const f = nativeScale`), or shadowing local is not a native call.

## Format 1 (value parameters)

```ts
declare function nativeScale(value: number): number;
console.log(nativeScale(21));
```

```c
double native_scale(double value) { return value * 2.0; }
```

```json
{
  "ffi_format": 1,
  "functions": [
    {
      "name": "nativeScale",
      "symbol": "native_scale",
      "params": ["f64"],
      "returns": "f64"
    }
  ],
  "libraries": ["./libnative.a"],
  "system_libraries": []
}
```

```console
$ clang -c native.c -o native.o && ar rcs libnative.a native.o
$ scriptc build main.ts --ffi ffi.json -o app
```

Relative `libraries` resolve from the manifest directory. `system_libraries` names are linker-neutral (`["m"]` → `-lm`). C++ symbols need `extern "C"`. Pass the same manifest to `scriptc coverage` so call sites count as static.

The manifest is the ABI authority: TypeScript only has `number`.

| Class | TS | Native |
| --- | --- | --- |
| `f64` | `number` | `double` |
| `bool` | `boolean` | `uint8_t` (nonzero → `true`) |
| `u8` | `number` | `uint8_t` (JS modulo) |
| `u32` | `number` | `uint32_t` (`ToUint32`) |
| `i32` | `number` | `int32_t` (`ToInt32`) |
| `string` | `string` | `const uint8_t *, size_t` (UTF-8; param only) |
| `bytes` | `Uint8Array` \| `Buffer` | `const uint8_t *, size_t` (param only) |
| `void` | `void` | `void` (return only) |

Borrowed string/byte pointers last only for the call. Do not mutate, free, or retain them. Empty spans may be a null pointer; always use the length (embedded NULs allowed). No pointer/string/byte **returns** in current formats (ownership contract missing).

## Callbacks (formats 2–5)

Read [the FFI page](https://scriptc.dev/ffi) before inventing a manifest. Summary:

- **2** — call-scoped C function pointers + optional opaque `void *` context. Context slots are compiler-supplied; they are absent from the TypeScript declaration. Callback `id` ties independently positioned context entries. `lifetime: "call"`.
- **3** — copy-in `cstring` / `string` / `bytes` on callbacks before the closure runs.
- **4** — `lifetime: "retained"` plus a paired release binding (`release`: `"fnName:callbackId"`). Release must pass the **same function value** used to register. Inline literals as release args are rejected.
- **5** — `invoke: "foreign"` on retained, context-bearing, `void` callbacks. Native trampoline copies args, posts to the script event loop, returns immediately. Not real-time. Value-returning foreign callbacks are refused (deadlock). Direct script execution on native threads is unsupported.

`invoke` defaults to `"script-thread"`. Native calls are synchronous and must return normally — no C++ exceptions or `longjmp` across the boundary. Native code is outside scriptc RC/exception/sanitizer contracts.

Unsupported: variadics, struct-by-value, owned pointer returns, runtime dynamic loading. Archives must already match `SCRIPTC_TARGET`; cross-compilation does not translate native inputs. Manifest errors are SC5xxx.
