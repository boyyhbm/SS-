# Complete Racing Experience — implementation and evidence

The preserved baseline is [baseline.json](baseline.json), source `94206cb`. Audio-only `a86cf3a` was deployed first. The integrated content was implemented in `72f9b66`, `4c5c547`, `b423f2c` and `4df492e`; capture reports retain their actual source revisions. Production acceptance is recorded separately after deployment.

## Public release verification

The current application source is `d36fc8149a8cade6a62914aaafdadc3395a948d2`. [GitHub checks](ci-ready-fix.json) passed the unfiltered 147-unit / 32-browser suite. Both existing Render services deployed this source automatically. [Actual public acceptance](production.json) includes [seven routes](public-routes.json), two independent authenticated Chromium processes, different cars, virtual gamepad and keyboard controls, server-verified finishes, matching results, rematch and explicit room exit. The seven routes were verified across three executions at a conservative 12 m/s input-driver pace. This does not certify high-speed smoothness or physical hardware.

[Open NEXUS](https://nexus-web-ylcv.onrender.com) · [Real runtime media and measured frame times](https://nexus-web-ylcv.onrender.com/reports/racing-experience/index.html). The published captures retain their actual earlier source revisions; the subsequent update changes lobby selection/readiness, not their graphics or vehicle physics. [Public media integrity](public-media.json) checks every hosted file.

[Canonical persistence](public-persistence.json) passed after both hosted processes changed, before any further games. [Initial content-rollout persistence](public-persistence-initial.json) is retained separately. Fresh mobile registration, HTTPS-only session cookies, logout/login and library persistence are in [registration evidence](public-registration.json); that auth code is unchanged by the readiness update.

[Local preview restoration](local-preview-restored.json) also passed: the original database was migrated without reset, the current production build was rebuilt, and both original local processes returned healthy. Public hosting remains independent of those processes.

Repeated vehicle/paint messages now preserve readiness; actual changes still clear it. Ready waits for the account save and authoritative selection. Lobby color swatches also save to the account. [Regression evidence](ready-state-regression.json) covers a deliberately delayed garage request, real room messages and two-client finishes. Earlier failed public attempts are retained as `public-routes-attempt-01..04.json`; they are not counted as successful races. The five completed races in `public-five-routes-before-legacy.json` are retained with their original overall failed status: the subsequent legacy preparation did not reach both ready. A separate legacy retry waited for server acknowledgements and completed successfully; the cause of the earlier setup failures remains unconfirmed. The final public driver uses each car's wheelbase/steering limit, one keyboard PWM decision per 30 Hz slot, the newest read-only simulation sample and body-translation recovery. It sends normal input only and never sets poses, checkpoints or results. Video encoding is disabled during this functional check; the separate published recordings remain actual runtime footage.

## Audio

`GameAudioEngine` consumes authoritative/local physics: RPM, gear, throttle/load, wheel slip, contact impulse, position and camera mode. Four RPM bands, load/coast layers, limiter, shift cut/transient, tire rolling/slip, spatial remote engines and bounded Doppler feed separate buses and a compressor. Each registered engine has a different cylinder/timbre profile. City, industrial, mountain, circuit and coastal ambience use distinct original soundscapes. Buffers are cached per context, voices are limited to the local car plus five real peers, and runtime exit closes the context. Starting playback requires actual pointer/key/controller interaction; blocked playback has an explicit UI state.

This is original synthesized combustion/noise/tonal audio, not professional engine field recordings. Physical speakers/headphones were unavailable. Automated analyser checks establish audible digital output, response to input, gear changes, mute, account-persisted settings and bounded output; they do not certify subjective mixing quality or hardware crackle-free output. No rain system or cockpit interior is advertised.

## Six-car garage and actual physics

The account garage supports 3D inspection, orbit via pointer/buttons/right stick, model choice and three body colors. Selection uses authenticated `GameSave` key `garage-v1`. The same IDs/configurations drive single player, server simulation, local prediction, remote model selection and remote audio. Strict message schemas reject unknown IDs, versions and supplied physical overrides. `MatchParticipant.vehicleId/vehicleVersion` preserve the selected model with each new match; old records remain nullable rather than receiving invented identities.

| ID          | Class           | Drive |    Mass |  Power |
| ----------- | --------------- | ----- | ------: | -----: |
| meridian-r6 | Street Coupe    | RWD   | 1350 kg | 210 kW |
| pocket-gt   | Hot Hatch       | FWD   | 1120 kg | 165 kW |
| iron-v8     | Muscle          | RWD   | 1810 kg | 340 kW |
| vector-rs   | AWD Performance | AWD   | 1530 kg | 295 kW |
| apex-r      | Track Supercar  | RWD   | 1260 kg | 380 kW |
| nova-x      | Hypercar        | AWD   | 1690 kg | 650 kW |

Torque curves, gearing, final drive, wheel radius, mass, power, drag, tire grip, brake force, steering response/limit and nitro capacity affect movement. The center of mass influences load/steering and inertia. Spring/damping/travel produce bounded body pitch/roll; this remains arcade road-bound physics, not a full suspension/airborne/rollover simulator. Render interpolation retains the fixed simulation and never writes visual poses back into physics. Car orientation uses vehicle-local pitch/bank on elevated roads. World and gated private car contacts use vehicle mass/inertia and capsule dimensions.

[Measured physics benchmarks](vehicle-benchmarks.json) use a flat dry unconstrained surface at 120 Hz, no nitro. Garage bars come from these measurements, not invented ratings. They are game-model results, not claims about real cars. [Browser garage evidence](vehicle-browser.json) records six actual meshes, keyboard movement and durable selection.

## Designed tracks and preserved city

The original city graph and three routes remain. Two curved perimeter boulevards connect existing districts for Free Drive. Clearance uses full sampled curves with a mathematically bounded broad phase; the minimap fits actual network bounds. City route version is now 2, so incompatible clients must reload.

`tracks/geometry.ts` compiles authored centripetal Catmull–Rom splines into shared arc-length sections including elevation, width, banking and grip. Rendering, swept capsule boundaries, surface height/grade, gates, starting grids, minimaps and racing-line elevation use those same sections. Separate route definitions retain ordered checkpoint validation. Gravity and surface grip affect driving, and braking guidance uses the chosen car plus road grade.

- **Velocity Circuit:** original 1.85 km circuit, broad start straight, fast turns, technical switchback, pit buildings, grandstands, grid and curbs; 1–3 laps.
- **Eagle Ridge:** original 1.88 km mountain sprint with hairpins, ascent from about 15 m to 143 m and a descending finish; pine/rock environment.
- **Coastline Run:** separate original coastal sprint with long acceleration sections, broad bends, elevation changes, a sea surface, coastal terrain/palms and an arched tunnel.
- **NEXUS City:** preserved night streets/routes/free drive and the added sweeping perimeter connections.

The track browser uses actual in-game captures, calculated length/radius and the user's real records. No fictional online times or unavailable tracks are used. Heights are continuous, but there is no jump physics, traffic simulation, weather cycle or full open-world mountain exploration.

## Assets and licenses

- Existing **Car Concept**, Eric Chadwick / Darmstadt Graphics Group, CC BY 4.0; original concept Unity Fan. Existing removal/material/LOD modifications and attribution are preserved.
- Existing **Amazon Lumberyard Bistro**, CC BY 4.0; Godot port Logan Preshaw and modifications John James Gutib (Jamsers).
- Existing **Venice Sunset HDRI**, HDRI Haven / Poly Haven, CC0.
- Five distinct **Kenney Car Kit 3.1** models, CC0 1.0, commercial use explicitly permitted. They are stylized models around 2,000 triangles, substantially simpler than Car Concept; photoreal/high-poly quality is not claimed. Different shapes, not six paints of one mesh.
- **Kenney Racing Kit 2.0** and **Nature Kit** track props, CC0 1.0, commercial use explicitly permitted. Low-poly authored geometry is retained.
- Original NEXUS road/terrain/tunnel geometry, material preparation and audio DSP.

[Vehicle provenance](../../public/game-assets/vehicle-manifest.json) and [track-prop provenance](../../public/game-assets/track-manifest.json) retain pinned source URLs, SHA-256 hashes, author, license files and modifications. Scripts `prepare-vehicle-assets.mjs` / `prepare-track-assets.mjs` reproduce the pinned imports. `npm run assets:check` validates every shipped resource and license. No unlicensed candidate assets are shipped.

## Verification and limits

- [Gamepad garage navigation](garage-controller.json) and [track-picker navigation](track-controller.json) passed with standard-layout virtual controllers: six models, six track cards, actual selection, account save and cancel. Test setup uses ordinary registration fields; physical controllers remain unverified.
- [Local release checks](local-checks.json): 144 unit tests, TypeScript, ESLint, production build, 107 hashed resources and separately recorded browser scenarios.
- [Six recorded engine profiles](recorded-audio-levels.json) have measurable non-silent decoded audio with peaks below full scale. These are actual runtime recordings, not substituted engine files. The report gallery includes all six clips plus a real two-browser race on Velocity Circuit.
- [New-track delay/jitter/loss check](multiplayer-network-faults.json) passed at simulated 50/100/200 ms RTT; the last profile adds ±20 ms jitter and 2% command loss. This is application-message simulation, not TCP-loss or geographic latency certification. [Legacy route with configured cars](multiplayer-legacy.json) also completed with two real SDK clients.
- Unit coverage includes all six vehicles completing every city and new spline route through normalized controls, fixed-step equivalence, 3D line clearance/elevation, mass-dependent momentum and cached-road query equivalence. Two additional SDK tests verify that queued obsolete snapshots are coalesced before prediction/UI work, and pending snapshots cannot repopulate a room after leaving. Test totals and final CI results are recorded with the release evidence.
- [Six real SDK clients on all six non-legacy routes](multiplayer-six-cars.json): different models, shared starts, ordered server gates/finish, agreeing results, PostgreSQL persistence and rematch. Six rooms ran concurrently (36 genuine clients); this is a functional check, not a capacity certification. One reported client reconnected during the run. [Initial two-client track check](multiplayer-tracks.json) is also retained.
- [Browser route evidence](tracks-browser.json) is explicit about the scope and revision tested. More recent local/browser/public acceptance is recorded separately; a passing build alone is never treated as gameplay acceptance.
- GPU performance must be read from the actual capture reports. The available GPU is software SwiftShader; no modern gaming PC, physical controller or 1080p/60 FPS hardware certification is available. Synthetic Gamepad API tests do not certify a named USB/Bluetooth controller.
- Public competitive car-to-car contacts remain disabled. The private contact solver is gated and currently supports the city routes only. World contacts work on the new tracks. New-track inter-car contact synchronization is not claimed.
- A private mixed-car city browser run initially failed after repeated reconnects (one client exhausted its reconnection window). After snapshot coalescing, the repeated two-browser run completed with identical authoritative results. This single successful retry does not establish production contact stability.
- The five additional cars and nature/racing props need higher-detail licensed replacements to meet the user's visual target. Professional recorded engine layers also remain missing. Do not describe the current content as AAA parity or finished photoreal graphics.

## Extending content

For a car, import a legally verified model, record provenance and hash, add a versioned `VehicleConfig`, measure it with `npx tsx scripts/benchmark-vehicles.ts`, and test SP/server/prediction/remote rendering/audio before publishing. Bump the vehicle version when driving characteristics or collision dimensions change.

For a track, add authored knots/width/bank/grip to the track registry, increment its version on geometry/gate changes, and rebuild both Web and Multiplayer. Do not maintain a separate server map. Test six starting slots, seam/end boundaries, ordered gates, all cars, 3D guidance, render resource cleanup and two independent authenticated browsers before advertising network support.
