# Complete Racing Experience — implementation evidence

Baseline: [baseline.json](baseline.json), application source `94206cb`.

## Phase 1: working game audio

An independent `GameAudioEngine` consumes the existing simulation's speed, throttle/brake, lateral velocity, contact strength and camera position. It does not own or change car transforms. Four RPM bands, load/coast layers, a limiter, wheel-linked shift model, tire rolling/slip, contact transients, spatial remote engines, wind/ambient beds and an original quiet music bed feed separate buses and a headroom compressor. Buffers are generated once per context and reused. Voice counts and collision retriggers are bounded. Quality changes keep the audio context; runtime exit closes it.

The current engine uses original synthesized combustion samples and original noise/tonal effects, not field recordings or commercial game audio. This gives working state-dependent sound; professional recording/mixing quality is not claimed. Hood camera receives a closer, filtered mix; there is no cockpit interior. Spatial engine load for remote cars is approximate until authoritative powertrain telemetry is integrated. Weather-specific rain is not advertised.

Master, engine, tires, environment, effects, music and mute are saved as a per-user `GameSave` key through an authenticated, same-origin, strictly validated API. Existing race saves are separate keys. Playback is resumed from user input; an explicit enable-audio state remains visible when a browser blocks it.

[Actual browser result](audio-browser.json): real sign-up/library/game launch, audible analyser output after pointer start, keyboard acceleration/RPM rise and gear shift, output below clipping, mute, durable settings and account isolation. Four pure audio tests cover smooth band energy, transmission behavior, actual slip and input validation. Physical speakers/headphones were unavailable, so this does not certify listening quality, crackle-free hardware output or performance on a gaming GPU.

The first local attempt started before the production build finished and got an empty page; the server was restarted after build readiness. The next test incorrectly included the pre-unlock zero-voice sample in its active-voice assertion; it now checks running samples. The actual audio assertions were retained.

## Content still being integrated

The six-vehicle garage, vehicle-dependent physics and new track geometry are subsequent phases. Five distinct Kenney Car Kit source models have explicit CC0 commercial-use permission and are being prepared. Their authored geometry is stylized, substantially simpler than the existing Car Concept. They are not presented as photoreal professional car models. Existing public competitive vehicle contacts and hardware performance limitations remain unchanged.
