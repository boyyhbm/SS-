# Underground in NEXUS — Stage A

Experimental integration of **lguilherme44/nfsu1-web**, pinned at `327b22c39041f197a4cfdf2544f81799b332b6c7`. This is its real browser host, not a Three.js recreation. The repository and deployed services contain **no original game files, translated game C, or game Wasm**.

The launcher, local package importer, original-format save manager, isolated bridge and MIT browser host are implemented. **Original gameplay has not been tested here: no lawfully supplied compatible installation was available.** This is not a release of the original game.

## For a player

1. Open the NEXUS catalog → **Need for Speed: Underground** → **Add to Library** → **Setup / Launch**. Use desktop Chrome 140+ with a working WebGPU adapter. The launcher checks the actual browser capabilities.
2. On your own computer, prepare your own installed PC copy (`SPEED.EXE` 1.4). Download the local utility from the launcher. Install Node 24+, Python 3 with venv, bash and a compatible [wasi-sdk](https://github.com/WebAssembly/wasi-sdk/releases). Windows requires WSL2. The cloud NEXUS website does not perform this compilation for you.
3. Check the executable first:

   ```sh
   node prepare-underground.mjs --game "/path/to/installed/game" --check
   ```

4. Build a private offline package:

   ```sh
   node prepare-underground.mjs --game "/path/to/installed/game" --wasi "/path/to/wasi-sdk" --out "/private/path/underground-local"
   ```

5. If the browser blocks storage in the embedded launcher, click **Open separate launch**. The isolated runtime then opens as a first-party page without changing browser privacy settings. Select the **prepared output folder**, then **Launch local runtime**. Selecting the original installation directly does not run the recompiler. The tool does not download game content, upload it or start a server.

The first preparation requires Git/Python tool downloads and compilation time; the full upstream compile with a real game has NOT been run in this environment. The timestamp/image-layout guard is not a publisher signature or proof that every regional/modified executable works. Do not use a version bypass. The installation must include CARS, TRACKS, GLOBAL and FRONTEND, plus its audio/video/language assets.

On mobile/cloud-only devices without a compatible local installation and build environment, preparation is unavailable. There is no bundled game to download from NEXUS.

## Saves and controls

Create the profile in the **original game menu**. Its `.usr`, `.opt`, `.cfg` and `.ugd` files remain byte-for-byte in an account-scoped OPFS save overlay. Stop the game before export/import/backup. The JSON export is a container for the original bytes, paths, sizes and SHA-256; it does not convert the save format. Imports verify size/hash and known Underground 1.4 profile headers, stage the complete overlay, and publish its pointer only on success. A backup is created before import. Backups and saves never use NEXUS cloud-save APIs.

Use **Continue / Load Driver Profile** inside the original menu after relaunch. Clearing site storage, changing the runtime origin or using another browser/profile can make local data unavailable. Export important saves; requesting persistent storage is subject to the browser's decision.

Keyboard: arrows/WASD, E/Z gear up/down, Enter/Esc menus (upstream bindings). Standard Gamepad API input, analog triggers/sticks, and NEXUS controller remapping feed the upstream DirectInput mailbox. Configure the NEXUS Controllers screen before launch. This is a protocol integration; **physical Xbox, DualSense, DualShock 4 and wheels have not been tested**. No device certification is claimed. Original in-game control assignments still apply.

## Deployment / development

- `npm ci`, `npm run nfsu:bundle`, `npm run nfsu:check`.
- Existing Web and multiplayer services host the parent and MIT browser files respectively. No new paid service is required. Production example: `https://nexus-web-ylcv.onrender.com/play/need-for-speed-underground` embeds `https://nexus-multiplayer.onrender.com/nfsu/` after the change is deployed. These addresses alone do not imply that a particular commit is live.
- `NEXT_PUBLIC_NFSU_RUNTIME_ORIGIN` may explicitly select the separate runtime origin; otherwise derive HTTPS from `NEXT_PUBLIC_MULTIPLAYER_URL`. Build-time client configuration must match the actual services. The runtime host's `NEXTAUTH_URL` must identify the exact NEXUS Web origin for its frame-ancestor and bridge allowlist.
- For localhost, use Web on `localhost` and runtime on `127.0.0.1`, with different ports as needed. Cookies are not separated by ports, so the adapter changes the loopback hostname automatically and rejects a shared production hostname.
- Full-document navigation to the launcher is deliberate: COOP/COEP cannot be enabled by an ordinary client-side React route transition. Only this launch route receives isolation/delegation headers. Existing games keep their original headers.
- The first-party fallback carries the same hashed namespace, nonce and controller configuration in a URL fragment (not sent to the HTTP server). It has no opener connection or NEXUS auth credentials. The return address is fixed by the runtime host configuration. Modern storage partitioning may keep embedded and first-party OPFS buckets separate; keep using the same launch mode for your files.
- The browser host runs outside React, in a sandboxed cross-origin iframe or its isolated first-party page, with its own workers, shared Wasm memory, WebGPU and AudioWorklet. The bridge sends only a hashed account namespace and controller preferences; no NEXUS session token, email, password, cloud save or game bytes.
- `public/nfsu-runtime` contains only generated MIT JavaScript/tools/CSS/HTML/notices. It is committed so the multiplayer container can serve it without running the Next build. Rebuild it after changing the adapter/vendor sources. The static router accepts GET/HEAD only and a generated path allowlist; there are no game/Wasm/data upload or download endpoints.
- The catalog migration only inserts one row on a new slug. Existing game rows, accounts, saves and rooms are untouched. Underground is deliberately absent from the multiplayer server adapter registry.

## Current limitations

Original gameplay/physical controllers remain unverified. The launcher itself currently uses mouse/keyboard navigation; no controller-only setup claim is made. Launch/playtime history is not fabricated from setup visits. In the separate-page mode NEXUS does not yet receive game-session time. Returning or force-stopping can lose the game's most recent unsaved changes; finish saving in the original menu first. Public cloud saves, original multiplayer and direct-folder recompilation in the browser are not implemented.

## Boundaries

**Stage A:** owner-prepared local runtime and local data; experimental compatibility only. A compile, a card, or an OPFS test is not proof that the game runs.

**Stage B:** public original game / derived Wasm distribution is **not implemented or authorized**. MIT tools do not grant Electronic Arts rights. Do not place `SPEED.EXE`, data directories, `gen/` or derived `.wasm` in the repository, deployment image or public storage. No monetized protected-content distribution is added.

Read [the source audit](AUDIT.md), [license inventory](LICENSES.md) and [test report](TESTS.md).
