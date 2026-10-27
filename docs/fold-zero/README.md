# FOLD: ZERO — first playable / NEXUS FORGE

This is the first playable development stage, not the finished premium game. Existing NEXUS accounts, libraries, friends, invitations, controller profiles and MIDNIGHT OUTLAWS remain in place. There is no second account system, fake opponent or public bot population.

## Running

Use the normal NEXUS setup in the root README. Apply migrations and seed, then run Web and the existing multiplayer process. The additive `20261027060000_fold_results` migration adds nullable JSON result details; existing racing records are unchanged. Seed creates only the new catalog entry and never adds it to a user's library automatically.

Find **FOLD: ZERO** in Discover, add it, launch, and choose Quick Match or Private Duel. An empty public room waits for a real opponent. Private entry requires a valid platform invitation; knowing a code alone does not bypass admission. Both players ready up; the leader starts. Mouse capture requires a click in the scene. Escape opens a personal menu and sends neutral input; it does not pause the server.

## Runtime boundaries

| Module              | Responsibility                                                               |
| ------------------- | ---------------------------------------------------------------------------- |
| `NexusForgeRuntime` | Lifecycle, one render RAF, bounded fixed-step prediction, clean exit         |
| `ForgeRenderer`     | WebGL 2, linear lighting, ACES/sRGB, IBL, shadows, instanced modules         |
| `ForgePhysics`      | Rapier 0.21 capsule movement, ramps, contacts and live Fold colliders        |
| `ForgeInput`        | Pointer Lock, mouse/keyboard, account-configured NEXUS gamepad actions       |
| `ForgeAudio`        | Original Web Audio synthesis, category buses, spatial events, bounded voices |
| `ForgeCamera`       | Immediate look and interpolated position; optional small head bob            |
| `ForgeAnimation`    | Original skeletal clips and crossfades for the provisional characters        |
| `ForgeAssets`       | Explicit GLB loading, skeleton-safe instances and resource cleanup           |
| `ForgeCombat`       | Server weapon rules, Rapier hits, bounded actor rewind and damage            |
| `ForgeArena`        | Node hold/warning/cooldown, swept-volume safety and shared transitions       |
| `ForgeNetworking`   | Adapter over existing signed NEXUS admission, Colyseus and invites           |
| `ForgeEffects`      | Bounded pooled hit particles                                                 |
| `ForgePerformance`  | Actual frame intervals, p99, render/physics CPU and draw calls               |
| `ForgeUIBridge`     | Bounded React HUD updates and copied read-only QA observations               |

Rendering never writes positions into the server simulation. The server runs 60 Hz fixed steps; snapshots start at 20 Hz. The client predicts movement, replays unacknowledged input and smooths correction. Remote actors are rendered from an 85 ms interpolation buffer. The input's observation tick follows the displayed state, not an arbitrary claimed position. Catch-up is capped after a main-thread stall; this protects responsiveness but cannot make a software GPU meet a gaming-PC target.

The shared platform still owns user identity, library eligibility, room allocation, private access, blocks, invites, presence and one active room per account. The Forge adapter supplies different game state/input contracts, not incompatible platform users or matchmaking. Maximum room capacity is two. Reconnection retains the seat for 30 seconds; leaving or exhausting reconnection forfeits the duel. A server restart loses active rooms and marks unfinished matches aborted; completed PostgreSQL results remain durable.

## Rules and security

`config.ts` is the balance source: 100 HP, VECTOR R9, 24 rounds, 1.9-second reload, deterministic aim, distance falloff and a head region on the provisional capsule. The server decides hits, health, magazine, cooldowns, Core and results. Same-tick lethal shots resolve together, without priority for the first slot. There is no client result-submission endpoint.

Ray queries use Rapier shapes. Only player poses may rewind, at most 12 ticks / 200 ms. Static geometry and moving Fold modules always use current server transforms, so compensation cannot shoot through a currently closed wall. Strict Zod commands reject supplied position, damage, target IDs, nonfinite values and out-of-range movement. Old sequences are ignored; excessive gaps/invalid messages are rejected. The existing payload limit and origin checks apply, and rooms cap message frequency. Existing short-lived connection tickets, account token versions and production WSS are reused.

The Foundry has two spawn shields, side lanes, low cover, ramps, two upper decks and a bridge. Spawns swap between rounds. The three shared nodes are SHIFT, TURN and LINK. Hold F / RB while close and aimed at a visible node. A charge is spent after the short hold, followed by 0.65 s warning and 0.7 s movement; cooldown is 12 s, with two charges per round. Occupied swept volumes cancel and refund the change before movement. The highlighted reserved footprint prevents entry during movement, without damage or crushing. This conservative first-stage safety rule needs further playtesting.

First to five round wins. Core opens after 45 s; a solo five-second hold wins. Contest pauses progress; leaving the zone resets it. A 75-second round enters a 20-second overtime. Its deterministic verdict compares capture, health, damage and distance to Core. An exact tie is a draw. Matches are bounded to 15 rounds, with a match draw possible, so a stalemate cannot run forever. These are initial rules, not a certified competitive balance.

## Controls and settings

WASD / left stick move; mouse / right stick look; left mouse / RT shoot; right mouse / LT aim; Shift / L3 sprint; Space / A jump; Ctrl / B slide; R / X reload; F / RB Fold; Q / LB Impulse; Esc / Menu opens the personal menu. Input is analog where provided. NEXUS controller deadzone, inversion, trigger bindings and remaps are reused. Additional aim sensitivity and a response curve are saved per account in `forge-settings-v1`, with graphics and audio settings. The standard sprint button is currently L3. Physical controllers, Bluetooth/USB combinations and controller-only audio activation remain unverified.

The first renderer has Competitive / Low / Medium / High / Ultra / Auto. Resolution scale and shadows differ; geometry relevant to visibility and combat is retained. Auto measures real frames in the menu and commits a tier before combat; changing a volume slider retains that choice. Advanced texture tiers, AO, baked lighting, WebGPU comparison and dynamic resolution are later work. Motion blur and temporal accumulation are not used.

## Verification

The final local production-build browser run passed with one acknowledged Start click: two independent accounts/processes, virtual standard Gamepad API versus keyboard/Pointer Lock mouse, five rounds, 70 shots, 15 server-confirmed hits, Fold geometry, matching persisted results, rematch and refreshed profile statistics. [The uninterrupted video and screenshots](../../public/reports/fold-zero/index.html) are actual runtime captures. They are automated-input clients, not two human players. Original live Web Audio was recorded from the same browser; the digital output was non-silent with headroom. Earlier unsuccessful preparations remain in the evidence directory and are not counted as passes.

Final local checks: 162 tests in 29 files, TypeScript, ESLint, asset hashes and an isolated production build. The full platform browser regression also runs in GitHub CI before deployment. [Performance details](performance.md) distinguish native High/Ultra menu captures from reduced-resolution functional gameplay. The first playable has not passed final art or hardware acceptance.

- [Authoritative SDK matches](network.json): two real authenticated SDK clients per profile, complete five-round matches, common Fold state/results, PostgreSQL settlement, private-access rejection, duplicate-start rejection and rematch. Profiles emulate 20/50/100/150 ms round-trip message delay; the last adds ±15 ms jitter and 2% application-command loss. This is not TCP packet-loss or geographic testing. The first profile also interrupts a real socket and reconnects the same seat.
- [Baseline SDK match](network-baseline.json) is retained separately. An earlier failed harness run tried to navigate through actual low cover; its failure remains in `network-attempt-01.json` and is not counted as a passing test.
- `tests/forge.test.ts` checks fixed steps at 30/60/120 presentation rates, real movement/contacts, weapon limits, elimination, simultaneous kills, bounded rewind/current-wall occlusion, Fold safety, contested Core, overtime and a full input-driven five-round match.
- Browser, media and performance evidence is recorded separately. A successful build is not multiplayer or visual acceptance. Earlier unsuccessful browser fixture runs are retained; they are not claimed as successful games.

Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run assets:check`, `npm run build`, and `npm run test:e2e -- tests/e2e/fold.spec.ts`. Run `npm run test:forge` only against the explicitly disposable local QA/CI database accepted by its guard. `NEXUS_TEST_NETWORK=1` enables all delay profiles. Fixtures create and remove only their own users and match rows. Public credentials and raw cookie-bearing traces are never release artifacts.

## Art, licenses and remaining stages

Five GLBs are original project assets, reproducible with `blender -b -P scripts/build-forge-assets.py`. Their provenance, development status and SHA-256 values are in [the manifest](../../public/game-assets/forge/manifest.json). Geometry is authored with bevels, materials, a simple rig and original clips; the two robots have different silhouettes but identical gameplay. Audio is original DSP, not protected recordings. Three.js is MIT; Rapier is Apache-2.0. No extracted Overwatch, Valorant, Splatoon or other commercial game content is used.

The art is provisional. Premium character/weapon production, final arena architecture, refined first/third-person weapon attachment and animation, dedicated impact/occlusion polish, controller remap UX, sustained human balance tests and hardware profiling remain. Slide currently changes movement, not capsule height; full mantle/parkour and skeletal hitboxes are not implemented. The first-person recoil is presentation feedback, not a finished competitive recoil model. No aim assist is enabled. The graphics/art/audio acceptance and 60/120 FPS gaming-PC targets are not claimed complete. Software-renderer measurements must be read with their actual resolution and capture overhead.
