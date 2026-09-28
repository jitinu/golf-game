# Texture assets

## `terrain/`

Per-surface PBR tile sets (`<region>_color.jpg`, `<region>_normal.jpg` (OpenGL normal), `<region>_rough_ao.jpg` — roughness in R, ambient occlusion in G), 1K, derived from [ambientCG](https://ambientcg.com) materials (CC0):

| Region | ambientCG material |
| --- | --- |
| green, fairway, firstcut, rough | Grass001, Grass004, Grass005, Grass008 (tinted per region) |
| bunker | Ground054 |
| dirt | Ground048 |
| path | Gravel022 |

`TerrainMaterial.ts` loads these into texture arrays at start-up and falls back to procedural layers until they arrive. Gameplay never reads these — surface type comes from `surface.u8`.
