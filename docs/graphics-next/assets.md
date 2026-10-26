# Asset provenance

| Resource | Author | License / commercial use | Changes |
| --- | --- | --- | --- |
| [car](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept) | Eric Chadwick / Darmstadt Graphics Group GmbH (2024); original concept by Unity Fan | CC-BY-4.0; commercial use permitted | Full Car Concept geometry, emblem/license plate removal; Meshopt; PBR texture conversion |
| [environment](https://polyhaven.com/a/venice_sunset) | HDRI Haven / Poly Haven contributors, mirrored by pmndrs | CC0-1.0; commercial use permitted | Existing HDRI retained as global IBL |
| [district](https://github.com/Jamsers/Bistro-Demo-Tweaked) | Amazon Lumberyard; Godot port Logan Preshaw; modifications John James Gutib (Jamsers). NEXUS reconstructs materials, normalizes building pivots, builds LOD and Meshopt/WebP exports. | CC-BY-4.0; commercial use permitted | Reviewed building modules, pivots, LOD simplification, WebP/Basis conversion |
| [Wet pavement and curbstones](https://github.com/Jamsers/Bistro-Demo-Tweaked/tree/main/Textures) | Amazon Lumberyard; Godot port Logan Preshaw; modifications Jamsers | CC-BY-4.0; commercial use permitted | Format conversion, KTX2 mip generation; NEXUS-authored roughness based on original .73 material scalar and subtle grain variance; no upscaling |
| Basis Universal decoder | Binomial / Three.js r186 distribution | Apache-2.0 | Unmodified versioned runtime decoder; LICENSE shipped with assets |

Original notices: [Bistro attribution](../../public/game-assets/licenses/Bistro-attribution.txt), [car](../../public/game-assets/licenses/car-source.md), [HDR environment](../../public/game-assets/licenses/environment-source.md). Each immutable asset path, byte count and SHA-256 is in [graphics-manifest.json](../../public/game-assets/graphics-manifest.json). Color textures use sRGB, normal/roughness maps linear data. No commercial-game assets, generated screenshots or upscaled textures.

ETC1S is used for building color/emissive textures; UASTC/Zstd for linear maps and hero/road textures. Native sources cap texture resolution (Bistro up to 2048); Ultra/Cinematic do not invent 4K detail. Source material roughness and authored grain variance are used where a measured roughness image is absent.

## Still needed for the next art pass

- A commercially redistributable modular industrial/warehouse kit with loading bays, authored doors, roof structures and its own PBR/LOD assets. The current industrial district retains simpler legacy geometry.
- Additional finished street-end buildings and corner façades; some Bistro party walls are still exposed in the compact existing graph.
- A coherent urban vegetation/street furniture set with authored LOD/alpha mip chains for richer intermediate-distance detail. Existing small props remain limited.
- Authored lightmap UVs and verified bake data for this exact composed city if baked GI is pursued. No generated lightmap placeholder is presented as working lighting.

These are concrete art limitations, not advertised upcoming playable content. No unlicensed commercial-game resources are used to fill them.
