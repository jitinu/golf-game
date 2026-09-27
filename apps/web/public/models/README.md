# Model assets

| File | Source | Notes |
| --- | --- | --- |
| `golfer.glb` | [Ready Player Me](https://readyplayer.me) avatar export (full-body, Mixamo-compatible bone names, no `mixamorig` prefix, no embedded animations) | Free developer avatar used as an interim realistic body. `Golfer.ts` retargets the procedural swing clips onto it and creates the `ClubSocket` under `RightHand` at load. Replace with the MakeHuman → Blender → Mixamo character described in `docs/asset-pipeline.md` for production; the loader accepts either bone naming and prefers authored clips when the GLB contains them. |

Trees are generated at runtime with [`@dgreenheck/ez-tree`](https://github.com/dgreenheck/ez-tree) (MIT); no tree GLBs are required.
