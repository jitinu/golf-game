#!/usr/bin/env bash
# Compress the raw Blender GLB for the web: per-slot texture sizes, WebP, Meshopt.
set -euo pipefail
IN=${1:-out/golfer.raw.glb}
OUT=${2:-out/golfer.glb}
G="npx -y @gltf-transform/cli@4"
T=$(mktemp -d)
$G resize "$IN" "$T/a.glb" --pattern "*teeth*" --width 256 --height 256
$G resize "$T/a.glb" "$T/b.glb" --pattern "*{short02,Polo_Normal,Polo_Roughness,polo_basecolor,pants_basecolor,pants_normal,shoes05,shoe_normal,brown_eye}*" --width 1024 --height 1024
$G resize "$T/b.glb" "$T/b.glb" --pattern "*{cap_basecolor,glove_basecolor,belt_basecolor}*" --width 512 --height 512
$G webp "$T/b.glb" "$T/c.glb" --quality 85
$G prune "$T/c.glb" "$T/d.glb"
$G meshopt "$T/d.glb" "$OUT" --level medium
rm -rf "$T"
ls -la "$OUT"
