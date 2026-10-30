# Verification report — 2026-10-30

**Stage A infrastructure is implemented and technically tested. Original gameplay remains unverified.** No lawfully supplied compatible installation was available; this worker also has no usable WebGPU adapter. There is no video or screenshot of the original game and no claim that a race ran here.

## Completed checks

| Check | Result |
|---|---|
| Production Next/Web build | PASS |
| Main and separate strict browser TypeScript checks | PASS |
| ESLint | PASS, zero errors/warnings |
| Unit suite | 171 tests / 30 files PASS, including 9 new Underground adapter cases |
| Distributed MIT resource hashes / dependency graph / full notices / no game artifacts | PASS — 9 browser/tool resources, no game Wasm/data |
| NEXUS registration → catalog → Add to Library → Setup / Launch | PASS in Chromium |
| COOP/COEP/SAB, separate cookie hostname, strict origin/source/nonce bridge | PASS; forged exit messages ignored, no session token/cookie passed |
| Saved NEXUS controller config delivered to the adapter | PASS; analog triggers and remapped steering also covered by unit tests. No physical device certification. |
| Cross-site iframe OPFS restriction | Reproduced; first-party isolated launch PASS without disabling browser privacy settings |
| Actual isolated I/O worker, shared-memory WASI file RPC, cached file read and a missing-block error with zero game-data fetches | PASS with authored bytes, no game module executed |
| Prepared-folder import/reload with hashes and corrupt-replacement rollback | PASS with a synthetic format fixture; no original game content; no upload requests |
| Local save export/import/backup/restore/reload and two-account separation | PASS with authored header/byte fixtures, not a playable career profile |
| Interrupted save import (injected OPFS write failure) | PASS: previous files/pointer remain intact |
| Local utility help and rejection of an incompatible executable | PASS; no recompiler/gameplay invoked |

The actual browser test results and durations are in [technical-tests.json](technical-tests.json). The checked system/capabilities are in [environment.json](environment.json): Linux x64, Intel Xeon Platinum 8573C, 5 visible logical CPUs, 33 GiB visible RAM, Node 24.19.0, Chromium 154.0.8037.57. This is a headless cloud worker, **not a gaming PC**. WebGPU `requestAdapter()` returned null; the launcher correctly disables game start. OPFS works on the isolated first-party page. UI capture viewport: 1440×1000, DPR 1.

## Actual UI screenshots

- [Launcher / compatibility screen](screenshots/launcher.png) — real browser UI, no game loaded.
- [Local saves](screenshots/local-saves.png) — real OPFS UI with the explicitly synthetic `NEXUS_QA` format fixture. This is not evidence of original profile compatibility or gameplay.

No concept art, simulated car or video substitute is used as a game demonstration.

## Original-game acceptance — NOT RUN

| Scenario | Status / reason |
|---|---|
| Full x86 lift + wasi-sdk compile of the user's copy | NOT RUN — no compatible original executable; exact selected SDK/builtins license inventory is also pending an actual build |
| Original loading / intro / main menu / profile creation | NOT RUN — original files absent |
| Quick Race / Circuit / Sprint / Drag / Drift and full completion | NOT RUN — original files absent |
| Actual engine audio, mixing stability and no crackles | NOT RUN — original files absent; no audio-compatibility claim |
| Native save written by the game, original Continue and replay after relaunch | NOT RUN — container persistence tests do not prove native gameplay save compatibility |
| Keyboard and physical Xbox / DualSense / DualShock 4 / wheels in-race | NOT RUN — no original runtime/hardware; only protocol and virtual mapping tests |
| Wasm load/compile time, gameplay memory, FPS / 1% low / frame time | NOT MEASURED — no original Wasm / usable GPU; values in environment.json remain null |
| Input-to-photon latency / long sessions / GPU memory | NOT MEASURED |
| Original online/LAN | NOT IMPLEMENTED; absent from NEXUS room registry |
| Public protected game/Wasm distribution (Stage B) | NOT IMPLEMENTED / no rights established |

The optional runtime overlay measures real submitted frames and compile time only after a real module produces frames. It is not a GPU timestamp measurement or certification of 60 FPS. Resolution/FPS/audio controls pass supported upstream options; no decorative graphics engine rewrite is used.

## Existing-platform regression

15 distinct existing-platform scenarios passed across the initial run and focused retests: 12 Console scenarios (auth, isolation, admin, recovery, saves, real Midnight driving and a complete virtual-gamepad lap), two controller scenarios, and a full Fold duel with two independent browser processes/accounts, real Pointer Lock/keyboard and virtual-gamepad inputs, five rounds, server-verified matching results, and return to lobby. Actual shot/hit counters and the checked match behaviors are recorded in regressions.json.

The initial combined run passed 13/15. One Midnight cold-load assertion exceeded its original 15-second limit; an isolated retest with a temporary 90-second expect window passed without changing the production game. One native Fold Ready-button click timed out; the unchanged native scenario subsequently passed in isolation. An earlier Fold retry was interrupted when the cloud environment stopped the service/browser processes and is not counted as a pass. These timings/flakes are retained in [regressions.json](regressions.json), rather than hidden.

Functional graphics checks used E2E_SOFTWARE_DPR=0.15 / SwiftShader; they cannot establish game performance targets. The MIDNIGHT OUTLAWS and FOLD runtime source files remain unchanged.

## Publication status

The implementation is isolated from the earlier unfinished FOLD controls work. The catalog migration inserts only metadata for the new slug; it does not reset accounts, library rows, saves, matches or existing game content. All QA used a separate disposable local database.

Direct Render health/runtime verification from this workspace is blocked by the environment's HTTPS CONNECT proxy (403), and the GitHub REST/GraphQL API is likewise unavailable here. Public website HTML and Git transport are available. Do not infer live deployment or actual game readiness from a git push, a successful build or the supplied existing production URLs.
