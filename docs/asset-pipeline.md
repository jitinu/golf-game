# Asset pipeline

Downloaded visual assets are optional and live under `apps/web/public`; the game has procedural fallbacks.

## Character and animation

1. Export a MakeHuman character or build one with Blender MPFB.
2. Auto-rig in Mixamo. Place markers at the chin, wrists, elbows, knees, and groin before export.
3. Download the character with skin and import it into Blender.
4. Add a `ClubSocket` bone parented to the right hand. Export GLB with Draco disabled.
5. Run `gltfpack -cc -tc input.glb -o output.glb` to produce Meshopt-compressed geometry and KTX2 textures.
6. Retarget CMU Subject 64 (golf swing) BVH clips in Blender with Rokoko or Auto-Rig Pro. Correct foot sliding with IK pins, add a wrist hinge, and inspect club clipping.
7. Mark the impact frame and update the normalized `IMPACT_TIME` table in `apps/web/src/animation/Golfer.ts`.
8. Use the fallback names `idle`, `swing_full`, `swing_chip`, `putt`, `walk`, and `celebrate`.

## Clubs

Model club heads with a bevel modifier, normal-map grooves, and separate grip, shaft, and head material zones. Keep the proportions close to the simulation club table:

| Category | Typical loft |
| --- | ---: |
| Driver | 10.5° |
| Wood | 15–19° |
| Hybrid | 22° |
| Iron | 24–40° |
| Wedge | 45–60° |
| Putter | 2–4° |

## Textures and expected paths

Use `toktx --bcmp` for KTX2 normal/color maps and `gltfpack -cc -tc` for models. The optional asset downloader writes:

```text
apps/web/public/hdri/limpopo_golf_course_2k.hdr
apps/web/public/hdri/limpopo_golf_course_4k.hdr
apps/web/public/textures/<region>/{color,normal,roughness,ao}.jpg
apps/web/public/textures/grass/atlas.png
apps/web/public/textures/waternormals.jpg
apps/web/public/models/golfer.glb
apps/web/public/models/trees/<kind>.glb
apps/web/public/models/clubs/<category>.glb
apps/web/public/animations/{idle,swing_full,swing_chip,putt,walk,celebrate}.glb
```

The renderer checks for missing assets and falls back to generated textures, low-poly vegetation, and a procedural golfer.
