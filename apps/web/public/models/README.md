# Model assets

| File | Source | Notes |
| --- | --- | --- |
| `golfer.glb` | Generated headlessly by `tools/character/build_golfer.py` (Blender 4.2 + MPFB2 2.0.x) from CC0 MakeHuman assets: `young_caucasian_male` skin, `high-poly` eyes, `eyebrow002`, `eyelashes02`, `teeth_base`, `short02` hair, `namuhekam_male_polo_shirt`, `toigo_wool_pants`, `shoes05`; MPFB's built-in Mixamo skeleton (`mixamorig:` prefix). Packed with `gltf-transform` (Meshopt + WebP). | ~89k-triangle body (one baked subdivision) plus separate hair/eye/teeth/clothing/shoe meshes, polo normal + roughness maps, hair normal map. `Golfer.ts` bakes the IK swing onto the rig, creates the `ClubSocket` under `RightHand` at load, and prefers authored clips when the GLB contains them. See `docs/asset-pipeline.md` to rebuild. |

Trees are generated at runtime with [`@dgreenheck/ez-tree`](https://github.com/dgreenheck/ez-tree) (MIT); no tree GLBs are required.
