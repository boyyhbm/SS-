# Measured performance — first playable

These results describe this cloud environment, not the target gaming PC. CPU: Intel Xeon Platinum 8573C, five logical CPUs available, 35,743,760,384 bytes RAM. Chromium uses ANGLE Vulkan / SwiftShader Subzero software rendering. No physical GPU, physical gamepad or hardware audio output was available.

| Actual scene                        | Internal resolution                           | Last measured rolling FPS | Mean frame |  p99 frame | Draw calls |
| ----------------------------------- | --------------------------------------------- | ------------------------: | ---------: | ---------: | ---------: |
| High main-menu Foundry              | 1280×720                                      |                     0.637 | 1568.82 ms | 2583.20 ms |         45 |
| Ultra main-menu Foundry             | 1536×864                                      |                     0.343 | 2918.77 ms | 5683.10 ms |         45 |
| Recorded two-browser duel, client A | Reduced backing resolution, software DPR 0.15 |                     3.772 |  265.10 ms |  866.70 ms |         31 |
| Recorded two-browser duel, client B | Reduced backing resolution, software DPR 0.15 |                     3.656 |  273.55 ms |  666.70 ms |         35 |

The High/Ultra figures are sixteen samples of a main-menu environment, not a combat benchmark. Gameplay figures are the last retained rolling windows in the full-match recording test; they are not whole-match averages or GPU timings. Two browser processes and video/audio capture add overhead. Raw measured frame intervals are retained in [capture.json](capture.json) and [browser.json](browser.json), including stalls. GPU duration and VRAM are unavailable. The overlay's “1% low” is defined as 1000 / p99 frame time.

Static and moving architecture uses material-merged instancing. Character and weapon resources are preloaded; necessary shaders are compiled before entry. Rendering, the 60 Hz server simulation and fixed-step local prediction are separate. The camera uses immediate look and interpolated position. Unit tests compare physical outcomes at 30, 60 and 120 presentation rates; this is not a measurement of actual rendering at those rates.

The software environment is visibly slow. No smooth 60/120 FPS, gaming-PC frame pacing, final art quality or human competitive balance is claimed. Required next checks are native 1080p on a documented hardware GPU, high-speed mouse turns, two physical controllers, sustained combat with jitter, memory profiling and final-asset performance. No motion blur or temporal accumulation conceals the current results.
