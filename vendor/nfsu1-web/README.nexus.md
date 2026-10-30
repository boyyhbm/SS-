# Vendored browser host

Source: https://github.com/lguilherme44/nfsu1-web
Pinned revision: `327b22c39041f197a4cfdf2544f81799b332b6c7`.

Only the MIT TypeScript browser host, refresh/fullscreen helpers, original-save format parser, and MIT registry defaults are included. `UPSTREAM.json` records original source hashes. The original MIT notice is retained verbatim. No executable, translated C, derived game Wasm, game artwork/media, upstream server, cloud vault UI, service worker or original game data is included.

Reviewed NEXUS changes:

- `app/game.ts`, `host/proto.ts`, `host/io-worker.ts`: optional local manifest/cache directory; local mode fails a cache miss before any HTTP fetch. The real shared-memory/WASI/D3D9/WebGPU pipeline is preserved.
- `host/process.ts`, `app/game.ts`: AbortSignal plus worker boot failure/timeout cleanup.
- `host/process.ts`, `gpu/index.ts`, `audio/index.ts`: worker/worklet resources under `/nfsu/` on the isolated runtime host.
- `input/gamepad.ts`: apply the existing NEXUS controller profile to the upstream snapshot and honor the configured vibration strength/disable setting.

The NEXUS local preparer builds the unchanged pinned upstream compiler/runtime on the owner's computer. It does not publish the resulting module or original data. See `docs/underground/` for audit, rights boundary and verification limits. Do not import upstream generated `gen/`, `out/` or game folders into this vendor directory.
