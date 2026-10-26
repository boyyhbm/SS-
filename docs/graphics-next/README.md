# MIDNIGHT OUTLAWS — graphics update

2026-10-26. Source rendering revision `6250431`; pause UI/tooling revision `f7f85b0`. Release validation is recorded in [validation.json](validation.json). Public rollout status is reported there separately from local checks. Existing road graph, routes, physics, input, authentication, library and server authority are retained. No schema migration or game-result override is introduced.

## Implemented rendering

Three.js **0.186.1**, WebGL 2. Linear lighting, physically based materials, HDR half-float intermediates where supported, AgX and one final output conversion. Composer render targets receive actual supported MSAA; spatial SMAA is used by Cinematic and where target MSAA is unavailable. Ultra/Cinematic add half-resolution GTAO. Bloom and color grading have an intensity control.

High captures three local HDR reflection probes before the race; Ultra/Cinematic capture five. The car and road blend between nearby prefiltered probes while moving. Captures exclude race cars and virtual driving aids; cubemaps are never refreshed during driving. Static city shadows are cached in texel-aligned cells; moving cars have a separate live shadow map. This is an approximation of local radiance, not ray tracing, SSR, or dynamic reflections of other cars.

The main vehicle retains the licensed Car Concept, exported with full source geometry (213,195 triangles) rather than the previous simplified hero. Paint, glazing, tyres, rims, lights and brake lights have separate material behavior. Wheels remain articulated, body roll/pitch are time based. Five remote actors and their near/far geometry are created and warmed before starting. Only real server player identities can expose them. Parked cars also use detailed near geometry.

The city uses authored Bistro models, additional reviewed frontage placements, and source-native PBR textures. Detailed façades face the actual nearest street instead of presenting the kit's party walls to avenues. Road and pavement maps use the licensed wet-ground/curbstone sources, with separate linear normal/roughness maps, subtle world-space dampness and sparse existing wear. No AI imagery is used as a game render.

## Quality settings

| Preset | DPR cap | Shadows | Static distance | AO | Local probes | Texture policy |
| --- | ---: | ---: | ---: | --- | ---: | --- |
| Low | 0.85 | off | 140 m | off | global only | existing small fallback assets |
| Medium | 1.25 | 1024 | 350 m | off | global only | 1024 ceiling; compressed mip trimming before upload |
| High | 1.5 | 2048 | 480 m | off | 3 | 2048 color / budgeted linear maps |
| Ultra | 2 | 4096 | 650 m | GTAO | 5 | native district geometry and maps up to 2048 |
| Cinematic | 2 | 4096 | 800 m | GTAO | 5 | Ultra assets plus spatial SMAA |

Source resolution is the limit: the 4096 configuration ceiling does **not** mean fabricated 4K source textures. Vegetation, anisotropy, LOD ranges, nearby light count and legacy particle density vary by preset. There is no new city rain/particle simulation or baked lightmap system.

Auto performs short real render trials at the candidate preset's pixel ratio, starting with Low. Poor adapters stop early; faster adapters also test Medium. It does not select a tier from GPU names. Dynamic scaling reduces secondary effects first, then resolution in 5% steps with cooldown and hysteresis. It never changes large texture packs during driving. Graphics choice is device-specific; existing controller and driving-assist account settings are preserved.

## Assets and security

[Asset provenance and licenses](assets.md). Models use Meshopt. Color building textures use Basis ETC1S; linear maps, car and road use UASTC with authored mip chains. Hashed paths support immutable browser caching. Ultra is an optional external glTF pack rather than one oversized GLB. A WebP fallback is available if compressed loading fails.

The reviewed Basis decoder runs as a static worker with its own restricted policy. JavaScript evaluation needed by its Emscripten bindings is allowed **only in the worker**; the application retains its strict no-eval CSP. The worker has no network access. It receives the bundled transcoder binary and shipped texture buffers.

Offline regeneration uses the existing licensed source cache, `toktx`/`ktx` from KTX-Software 4.4.2, and these scripts:

```sh
python3 scripts/fetch-bistro-assets.py
KTX_BIN=/path/to/toktx node scripts/prepare-next-assets.mjs
KTX_BIN=/path/to/toktx node scripts/prepare-ultra-assets.mjs
```

Textures are never upscaled. KTX tools are not needed to install or run the deployed game. Decoder source and the Three.js/Basis licenses ship with the assets.

## Evidence and acceptance scope

- [Before fixtures](before/report.json): actual Three.js render with explicit synthetic visual poses; not gameplay or network evidence.
- [WebGPU compatibility probe](webgpu-probe.json): ordinary Chromium had no adapter; experimental software WebGPU rendered a subset but reported incompatible GLSL materials. Production stays on WebGL 2. No physical GPU comparison or WebGPU performance advantage is claimed.
- [Six real clients per city route](server-six-players.json): synchronized start, distinct positions, authoritative results in PostgreSQL and rematch; no rendering claim.

- Real keyboard video: [gameplay-keyboard.mp4](gameplay-keyboard.mp4).
- Real virtual analog controller video: [gameplay.mp4](gameplay.mp4), [input/capture report](video-pad/video-report.json), [export timestamps](video-export.json). The 24-second excerpts preserve real time and contain no interpolated frames. Medium / DPR 0.5 means the internal canvas is 640 × 360; encoded video size is not a claim of native 720p rendering or game FPS.
- [Platform screenshots](platform/): existing auth, library, lobby and console, retained from actual browser verification.
- [Four SDK clients per city route](server-four-players.json) and [six SDK clients](server-six-players.json) are real independent authenticated network sessions; fixture cars in graphics captures are explicitly synthetic rendering loads.
- [Before-update public baseline](public-before-route.json): two independent browser sessions, friend invitation, real WSS race and database-verified Downtown results on the previously deployed app. This is not final-release verification.

- [Native High runtime photos](free-high-verified/still-report.json) and [native Ultra runtime photos](free-ultra-verified/still-report.json): actual Free Drive, analog driving to the viewpoint, real pause-menu quality change, native 1280 × 720 capture. Navigation used Low/DPR 0.15 on the software GPU; capture used High/Ultra/DPR 1. No pose injection.
- [Actual six-preset measurements](performance.md), [raw frame times](metrics/performance-report.json), [summary](performance-summary.json): 1920 × 1080 viewport, actual per-preset internal resolution, shader/asset startup excluded from the sampling interval. Auto selected Low and reduced DPR from 0.85 to 0.5525. None of these short software samples establishes a reliable 1% low or gaming-PC performance.
- [Pause layout verification](settings/settings-report.json): actual production build on 1280 px and 390 px; settings no longer overflow horizontally. [Desktop](settings/pause-1280.png) / [mobile](settings/pause-390.png). Scene rendered on Low/DPR 0.15; UI captured at CSS resolution.
- Reviewable public media is exported into `public/reports/midnight-graphics/` from those completed runs. Fixed-pose before/after fixtures compare rendering using the same cameras; they are not represented as gameplay. Actual final-source public tests and persistence results are recorded separately after deployment.

 A software Vulkan/SwiftShader runner is available; there is no physical gaming GPU or USB/Bluetooth controller. High/1080p/60 FPS, physical controller models, SSR/TAA, cockpit rendering, baked GI and contact races at higher rendering resolutions remain unverified or unimplemented. Existing public competitive car contacts remain disabled; the previous higher-resolution contact failure is not declared fixed.

## Preserved gameplay and incomplete previous acceptance items

The route registry, three connected city routes plus original circuit, Free Drive, fixed-step simulation, interpolated visual/camera transforms, dynamic racing line, keyboard/analog input, world contacts and server-authoritative checkpoints/results are retained. The graphics layer consumes their state without changing movement or result rules. Final browser CI checks the complete controller-only and social/lobby journeys using virtual controllers.

No claim is made that every earlier directive has been accepted. Physical GPU frame pacing at 30/60/120 Hz, 200 km/h visuals, physical USB/Bluetooth pads, and stable public contact races are outstanding. The public competitive mode keeps inter-car contacts disabled. The city still has sparse areas, kit party walls and a simplified industrial district. The current licensed car is a detailed concept model with stylized proportions, not a newly commissioned production sports car. No cockpit camera is advertised. These limits remain visible in real captures.

The public evidence export is generated with `node scripts/export-graphics-evidence.mjs`; it refuses incomplete captures. Reproduce screenshots/videos with `scripts/qa-city.ts` against an isolated local QA database. It refuses non-loopback targets. Public functional verification uses the separately guarded `scripts/verify-public-routes.ts` and an explicit private ledger containing only two owned fixture accounts; no credentials are published.

## Additional release diagnostics

[High render-load fixtures](render-load/report.json) use 1/2/4/6 visible model actors (476/555/713/871 draw calls) in the same fixed scene. Two actual draws yield one timing interval; this is not gameplay FPS and no synthetic actor is represented as a real network participant.

The first exact-release CI attempt failed at a late registration redirect. [A disposable-database reproduction](ci-registration-isolation.json) confirmed HTTP 429 after the shared 30-request quota, HTTP 201 and a real successful redirect after guarded fixture isolation, and HTTP 429 again when the unchanged limit was reached. The existing local-only/disposable-only helper now isolates the online test group; production throttling has not been weakened. Full CI is rerun after this test-fixture correction.

Very slow software GPU stalls can exceed the simulation's bounded catch-up interval. The real-time videos and speed readouts are evidence of actual execution and engine telemetry, not a comfortable-frame-rate or gaming-PC certification.

## Collision query CPU follow-up

The public mixed-input Sprint check exposed a long client-side stall after contact near the second checkpoint and failed reconnection (4003). Lower backing resolution alone did not resolve it. The captured [trace](public-sprint-low-backing-trace.json) and failed attempts remain recorded; they are not reported as passes.

Road clearance previously scanned every sampled segment of straight roads and rebuilt junction adjacency/radius arrays for every point, including each replayed contact step. The exact-equivalent query now caches immutable segments/junction radii, uses one segment for straight roads, and prunes curved segments by exact distance lower bounds. The independent pre-change reference agrees to <1e-9 over more than 20,000 graph/boundary/contact queries. No track, collision rules, vehicle tuning or server result rules changed.

[Before CPU fixture](collision-cpu-diagnostic.json) / [after](collision-cpu-after.json): the sampled wall-contact step fell from about 0.88 to 0.16 ms on this runner. This is a synthetic CPU microbenchmark, not game FPS. The six-preset GPU-limited measurements remain explicitly dated before this CPU optimization; no new hardware FPS claim is inferred from them. The public failed scenario is retested after deployment.

## Bounded prediction follow-up

The next public check kept receiving state at the boundary but still showed multi-second processing spikes; the automated keyboard driver also remained against a road boundary without using reverse. Client prediction now retains at most 600 ms (18 commands at 30 Hz) of speculative replay instead of up to three seconds. All input commands are still sent, sequence numbers remain monotonic, acknowledgements restore authoritative state, and the server alone computes physics/results. Normal 50–200 ms links retain their full recent history. This is a bound on client work, not a relaxed result check.

The regression test sends 90 real command objects, verifies the complete ordered outgoing stream and bounded local replay, then verifies authoritative correction after acknowledgement. The integration driver can now recover through ordinary throttle/brake/steering input and actual reverse; it never writes a car pose, checkpoint, result or clock. Ready confirmation waits for the server-backed UI label after a transient disconnect. Failed attempts remain in the evidence. Full CI/public retesting follows this change.

[Post-query-cache measurements](post-cpu-metrics/performance-report.json) cover Low, High and Auto on the same software runner, using a short 30-second window. They are not hardware certification or a claim of an FPS increase; Auto may still be adapting when a short sample ends. The latest change affects online speculative replay only; the single-player render/physics measured there is unchanged.
