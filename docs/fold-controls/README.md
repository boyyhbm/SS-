# FOLD: ZERO — Foundry identity and personal controls

This increment preserves the existing authoritative duel simulation, server hit registration, Fold timing/safety, NEXUS authentication/library and MIDNIGHT OUTLAWS. `FORGE_VERSION=2` explicitly covers the two new symmetric wing roofs; the client and server must deploy together. No database migration or data reset is needed.

## Arena audit and changes

The old renderer ignored the architectural palette when instancing the same ivory prefab, then combined an almost-white environment map, strong hemisphere/key lighting and pale fog. Changing exposure alone would not establish readable zones.

Foundry now has navy structural steel, separate warm-concrete walkways, teal research panels and orange industrial service equipment. Original bevelled GLB kit parts are batched by shared material. Central machinery, inward-facing zone signs, bulkheads, pipe/vent banks and shared-collider wing roofs establish depth without inserting invisible obstacles into routes. High-resolution original floor color/normal/roughness maps are loaded before play. Optional contact masks are combined in one draw; Low/Competitive retain all gameplay cover and zone labels.

The working renderer is Three.js 0.186.1 / WebGL 2, linear PBR lighting, ACES output, prefiltered environment lighting, bounded warm/cool fills and one shadowed key light. Optional SSAO, restrained bloom and FXAA use an HDR composer where supported; an unsigned-byte target and FXAA/off remain available otherwise. MSAA is applied to the actual composer buffers. No TAA, screen-space reflections, motion blur or claimed baked GI is present.

## Settings that affect the game

Six in-game tabs open from the main menu and Escape/pause. The server keeps running during settings and receives neutral client commands. Returning to play retains yaw/pitch, requests Pointer Lock from the resume gesture and waits for held controls to be released.

- **Mouse:** master and independent X/Y sensitivity, ADS multiplier, Y inversion and an optional unadjusted-movement request. The browser cannot positively confirm raw mode; the UI reports the request or explicit fallback rather than claiming support. Mouse deltas are not scaled by frame time.
- **Controls:** all existing movement, combat, Fold and menu actions support physical key/mouse-button capture, cancellation, conflict swapping and individual/section resets. Escape is a permanent menu recovery key. Interact is an alternate Fold activation; no nonexistent crouch or voice-chat action is advertised.
- **Controller:** uses the single NEXUS input manager and existing HID/device profiles. Independent game-specific axes, deadzones, three response curves, ADS, inversion, vibration and button/trigger bindings do not overwrite the platform profile. Menu/Options remains a recovery button. LB/RB changes tabs; the standard platform focus navigation adjusts sliders and operates dialogs.
- **Crosshair:** the same SVG component drives live preview and combat. Color, length, thickness, opacity, gap, outline, dot and optional local movement feedback are real. It reads no hidden target information.
- **Graphics:** presets, render scale, floor texture tier, shadow-map resolution, MSAA/FXAA/off, particle count, contact AO/SSAO, environment reflections, bloom, presentation cap, FOV and optional head bob. Unsupported options are disabled. No runtime/network restart is required. Auto measures actual pre-match frames; it never changes major quality settings during combat.
- **Audio:** master/mute and separate weapon, footstep, effects, UI, environment and menu-music buses. Original quiet synthesized menu music is disabled during a live match, including while settings are open. Preview changes are reversible before Apply.

## Persistence and shared-device safety

The account owns `forge-settings-v2` in the existing PostgreSQL `GameSave` table. Legacy v1 preferences migrate on read; old browser tabs can write only the old slot. Writes carry the authenticated owner ID, expected revision and idempotent mutation UUID. A transaction locks the owner row, preventing lost updates across concurrent writes. Conflicts require an explicit choice of cloud or local settings.

The fallback key is `nexus:forge:settings:v2:<immutable account ID>`. Pending edits survive offline reload and retry. Lost acknowledgements do not produce duplicate revisions. A changed authenticated account disables writes from the old tab. Inaccessible local storage is reported rather than described as durable. No secrets or account tokens are stored in the settings record.

## Evidence and limits

`baseline-public.json` and `baseline-deployment.json` preserve the previous release's actual verification, including the old public Fold-fixture failure. That failure is not relabelled as a pass. The new local art-stage duel in `gameplay.json` passed with two authenticated browser processes, real device-event paths, server-observed Fold transitions, hits and PostgreSQL results; it precedes the final controls/pipeline changes.

`arena-review.json` and `arena-review/high-menu.png` record an intermediate native-resolution art review. The latter is a running menu scene, not a combat benchmark. SwiftShader software rendering on this Xeon environment is slow; neither it nor reduced-resolution functional tests certify 60/120 FPS, physical gamepads, audio hardware or premium finished character animation. Final settings, networking and capture reports are added only when executed.

## Original assets

`public/game-assets/forge/foundry/manifest.json` and `textures.json` identify the original Blender kit and generated clean PBR maps, sources, provenance and hashes. The new kit is approximately 817 KB; complete new Foundry art is approximately 1.55 MB. All new materials, geometry, decals and DSP audio are original project resources and may be distributed commercially with this project. No commercial-game assets or generated concept-art screenshots are used.
