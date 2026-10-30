# Technical audit

Inspected the actual source checkout at [327b22c39041f197a4cfdf2544f81799b332b6c7](https://github.com/lguilherme44/nfsu1-web/tree/327b22c39041f197a4cfdf2544f81799b332b6c7), not just its description. The original checkout is separate from the NEXUS repository. `vendor/nfsu1-web/UPSTREAM.json` records the revision and SHA-256 of each imported, unmodified source file. NEXUS-specific source changes are listed below.

## What exists upstream

The upstream [README](https://github.com/lguilherme44/nfsu1-web/blob/327b22c39041f197a4cfdf2544f81799b332b6c7/README.md) reports intro video/audio, profile creation/load/save, starting and moving in six Quick Race modes, first career event, and some Drag post-race behavior in Chrome on macOS Apple Silicon. It explicitly leaves complete race coverage, customization, options, controllers, wheels, long sessions, Firefox and Safari unverified; original online/LAN is not working. Those are **upstream claims, not NEXUS test results**. We did not receive compatible original files.

## Static recompilation

[`web/gen.sh`](https://github.com/lguilherme44/nfsu1-web/blob/327b22c39041f197a4cfdf2544f81799b332b6c7/web/gen.sh) accepts the x86 PE32 `SPEED.EXE` 1.4 with timestamp `0x40072965`, image base `0x400000`. Python `pefile` parses the PE; Capstone disassembles it. `tools/lift.py`, `genall.py`, argument-count analysis and roughly 30,866 seeded function addresses generate C shards in `gen/all`. `runtime/overrides.c` contains version-specific hooks. `X87PC=0`; guest pointers retain the x86 layout.

[`web/build.sh`](https://github.com/lguilherme44/nfsu1-web/blob/327b22c39041f197a4cfdf2544f81799b332b6c7/web/build.sh) uses wasi-sdk Clang/wasm-ld, not Emscripten: wasm32-wasip1-threads, shared linear memory, pthreads, SIMD, bulk memory, tail calls and Wasm EH/SjLj support. It links translated game functions with Windows/API compatibility code. Default initial memory is **1 GiB**, maximum 4 GiB; guest memory end is `671088640`. Output is `out/web/nfsu1.wasm` and build JSON. The output contains **derived original game code** and cannot be publicly distributed under the tooling MIT license.

The local NEXUS preparer pins that source revision, requires a clean checkout, disables the upstream `NFSU1_ANY_EXE` override, runs the actual two scripts, checks the executable hash stamp and build metadata, and packages output with file hashes. It never replaces the lift/build stage with a file picker. Compiler compatibility and the full build still require validation against the user's actual copy/toolchain.

## Browser process and rendering

`host/process.ts` allocates shared WebAssembly memory, an I/O worker and a pool of up to 24 game workers by default. `_start` and `wasi_thread_start` run through custom WASI/Windows shims; `GameSession` attaches registered GPU/audio/input mailbox subsystems. Each Play creates a new process because the runtime is not reentrant. NEXUS adds abort/error/timeout cleanup during worker boot.

`runtime/com.c`, `runtime/web/gpu_web.c` and browser `gpu/` implement D3D9 state/resources/shader translation and queued WebGPU rendering. This is **the original game renderer translated to WebGPU**, not a Three.js scene. The built-in browser WGSL is host copy/compositing/fixed-function logic; original shader/material assets remain in the user's data/derived module. No WebGL fallback is implemented by this port. Adapter detection must request a real WebGPU adapter. Texture BC support affects memory: upstream warns the uncompressed fallback may cost about 200 MB more. No GPU budget or performance result is claimed here.

## Audio, input and menus

DirectSound-compatible mixing feeds a shared PCM ring consumed by the browser AudioWorklet. NEXUS creates/resumes AudioContext in the actual Play gesture, offers a resume button, closes it on stop, and can pass `NOSOUND=1`. Engine sound stability requires actual game assets and a real race; not tested here.

`input/` translates keyboard scan codes, characters and mouse coordinates into the original input mailbox. The game itself renders/owns its menus. Gamepad API snapshots map sticks, analog triggers and buttons to the virtual DirectInput device with a seqlock; family identification changes prompts, not hardware certification. NEXUS applies its existing saved per-user controller profile before mailbox publication and scales/disables vibration according to that profile. Original in-game assignments remain authoritative. Pointer lock/fullscreen stay within the runtime frame. No original menu is recreated in React. The isolated browser bundle disables optional Zod JavaScript JIT; it keeps a strict CSP with wasm-unsafe-eval and does not enable JavaScript unsafe-eval.

## Files and saves

The I/O worker mounts `/data` read-only and `/save` as a writable OPFS overlay. Game paths are case-insensitive. Upstream's lazy cache uses 1 MiB blocks and `.have` maps under `cache/`, keyed by sanitized path, size and mtime. Its original server serves `/data` and block endpoints. **Those endpoints/servers are not used in NEXUS.**

Native `showDirectoryPicker()` requires a user gesture and browser permission and cannot be assumed to work in a cross-origin frame. This first version uses a directory file input (`webkitdirectory`) to obtain explicitly selected File objects and copies them into OPFS; it retains no persistent access to the original OS folder. The first-party mode also avoids cross-site storage denial.

NEXUS imports the verified prepared folder into a fresh OPFS cache directory, prepopulates all cache blocks and `.have` maps, stores the game module locally and atomically publishes the account's install record. The manifest is a local Blob URL. A cache miss with `dataBase: nexus-local:` fails before any network request. There is no server fallback for original game data.

`app/ug1save.ts` documents the original profile family: `NFS Underground/Profiles.usr` (count + 32-byte profile names), `<NAME>.opt`, `.cfg`, `<NAME>_<slot>.ugd`. `.opt/.ugd` start with version `0x13`. NEXUS preserves full bytes, canonicalizes only the Windows save-directory casing for OPFS, verifies known headers for imports, uses a per-account namespace and a Web Lock, and disallows save import/export while the game's synchronous I/O handles are open. An interrupted import cannot publish a partial save overlay. Cloud vault/service-worker features from upstream are not included.

## Isolation and NEXUS integration

Secure context + WebGPU + shared Wasm memory require cross-origin isolation: COOP `same-origin`, COEP `require-corp`, CORP for resources, and explicit cross-origin-isolated/Fullscreen/Gamepad delegation into the separate host. Web Workers and AudioWorklet are same-origin to that host. `Atomics.waitAsync`, Web Locks and OPFS are also checked.

Only `/play/need-for-speed-underground` gets the isolated parent headers. The existing multiplayer HTTP service serves MIT resources at `/nfsu/`, before its normal NEXUS-only Origin guard; its existing WebSocket/auth/room checks remain unchanged. Parent and child validate both event origin and source window, the protocol, version and one-use per-mount nonce. Only the hashed account namespace and controller configuration cross the bridge. No original game data or account secret is sent.

The browser checks OPFS by actually opening its directory, not by testing API presence alone. Chromium can deny it in a cross-site iframe. NEXUS offers first-party navigation to the isolated runtime with a strict, bounded launch fragment containing only the hashed namespace, nonce and controller settings. COOP separates the browsing groups; no NEXUS opener or credentials are retained. Return navigation uses the fixed configured NEXUS origin. The fragment is not sent to the runtime HTTP server. This fallback is browser-tested and avoids asking players to disable privacy protection. Storage partitioning can separate iframe and first-party data buckets.

Game Registry, explicit dynamic player adapter, catalog migration/seed snapshot, library ownership check and authenticated play route are reused. The entry clearly requires the owner's copy, has neutral original NEXUS artwork and a Setup / Launch action. Local saves do not enter the general NEXUS cloud-save flow. MIDNIGHT OUTLAWS and FOLD game runtimes are unchanged; the FOLD online page only passes the shared account ID context field.

## Performance and remaining work

Likely bottlenecks from code inspection: multi-hundred-MB compiled module and generated code, 1 GiB+ shared memory, up to 25 workers, CPU command decoding and shader/pipeline creation, texture format fallback, initial OPFS copy/hash cost and storage quota. Real bottlenecks must be measured with original files. A short upstream rAF refresh-rate measurement feeds NFSU2_DISPLAY_HZ/Auto pacing; it is not a gameplay benchmark. NEXUS exposes supported resolution/FPS/audio controls and frame-submission cadence, rolling mean frame time, slowest-1%-mean FPS, compile time and actual Wasm memory size once real frames arrive. These are CPU submission observations, not GPU timer or total browser memory measurements.

Still required with lawfully supplied files: game bootstrap/menu/profile, all race modes through completion, save/relaunch, engine audio stability, physical controllers, input-to-photon latency, long-session memory, real FPS/1% low/frametime on declared GPU hardware. Browser setup checks are not substitutes.

Original online/LAN uses legacy EA network protocols; inherited nfsu2 virtual-LAN/cloud infrastructure does not establish NFSU1 compatibility. NEXUS passes `netName: null`, disables online/roam and registers no Underground multiplayer room. A future adapter requires separate protocol research, authoritative compatibility and actual two-client tests. No opponents or networking readiness are fabricated.
