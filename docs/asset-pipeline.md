# Asset pipeline

Downloaded visual assets are optional and live under `apps/web/public`; the game has procedural fallbacks.

## Character and animation

`apps/web/public/models/golfer.glb` is built entirely from CC0 sources with no manual Blender work; `tools/character/` holds the scripts.

1. Install Blender 4.2 LTS and the [MPFB2](https://static.makehumancommunity.org/mpfb.html) extension, then download the CC0 MakeHuman packs (system assets, `hair01`, `shirts01`, `pants01`, `shoes01`) from the MakeHuman asset repository and unpack them into MPFB's user data directory (`~/.config/blender/4.2/extensions/.user/user_default/mpfb/data`). `blender -b --python tools/character/enable_mpfb.py` enables the extension headlessly.
2. `blender -b --python tools/character/build_golfer.py -- out/golfer.raw.glb` creates the human (macro targets, `young_caucasian_male` skin, eyes/eyebrows/eyelashes/teeth, `short02` hair, polo shirt, wool trousers, `shoes05`), adds MPFB's built-in Mixamo skeleton, wires the polo normal/roughness and hair normal maps into the PBR materials, bakes one subdivision level into the body and exports a GLB. Set `MPFB_DATA` if your MPFB data directory differs.
3. `tools/character/pack_golfer.sh out/golfer.raw.glb apps/web/public/models/golfer.glb` resizes textures per slot, converts them to WebP, prunes and Meshopt-compresses the file (~3 MB).
4. Optional, for a mocap swing: retarget CMU Subject 64 (golf swing) BVH clips onto the same skeleton in Blender (Rokoko or Auto-Rig Pro), fix foot sliding with IK pins, add a wrist hinge, check club clipping, and export the clips named `swing_full`, `swing_chip`, `putt`, `celebrate`, `idle`, `walk` in the GLB. Mark the impact frame and update `IMPACT_TIME` in `apps/web/src/animation/Golfer.ts`. When the GLB contains no clips, `SwingBaker.ts` bakes an IK swing onto the rig at load using the rig's rest pose to derive hand frames, so the same code works with any Mixamo-named skeleton.

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
