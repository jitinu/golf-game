"""Generates the golf-apparel base-colour textures used by build_golfer.py (PIL + numpy).

Run: python3 make_textures.py <mpfb data dir> <out dir>
"""
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

data_dir, out_dir = sys.argv[1], sys.argv[2]
os.makedirs(out_dir, exist_ok=True)
rng = np.random.default_rng(7)


def save(name, rgb):
    Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB").save(os.path.join(out_dir, name))


def noise(size, scale, seed):
    small = np.random.default_rng(seed).random((max(1, size // scale), max(1, size // scale)))
    img = Image.fromarray((small * 255).astype(np.uint8), "L").resize((size, size), Image.BICUBIC)
    return np.asarray(img, dtype=np.float32) / 255.0


def pique(size, cell):
    """Honeycomb-like knit relief typical of polo pique fabric."""
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    a = np.sin(x / cell * np.pi * 2) * np.sin(y / cell * np.pi * 2)
    b = np.sin((x + cell / 2) / cell * np.pi * 2) * np.sin((y + cell / 2) / cell * np.pi * 2)
    return np.maximum(a, b) * 0.5 + 0.5


def twill(size, period):
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    return (np.sin((x + y) / period * np.pi * 2) * 0.5 + 0.5)


# Polo: deep navy pique with fine knit relief and slight wear variation.
S = 1024
knit = pique(S, 4.0)
wear = noise(S, 64, 1)
lum = 0.86 + knit * 0.14 + (wear - 0.5) * 0.08 + (rng.random((S, S)) - 0.5) * 0.04
navy = np.array([28, 42, 74], dtype=np.float32)
save("polo_basecolor.png", navy[None, None, :] * lum[..., None])

# Pants: tint the CC0 wool weave to a stone/khaki golf trouser.
pants_src = Image.open(os.path.join(data_dir, "clothes/toigo_wool_pants/Pants_wool.png")).convert("L")
pants = np.asarray(pants_src, dtype=np.float32) / 255.0
pants = (pants - pants.mean()) * 1.6 + 0.5
stone = np.array([176, 164, 138], dtype=np.float32)
save("pants_basecolor.png", stone[None, None, :] * (0.72 + pants[..., None] * 0.5))

# Cap: white performance twill with a faint weave.
C = 512
cap = 0.9 + twill(C, 3.0) * 0.08 + (noise(C, 32, 2) - 0.5) * 0.05
save("cap_basecolor.png", np.stack([cap * 245, cap * 244, cap * 240], axis=-1))

# Glove: white cabretta leather grain.
G = 512
grain = np.asarray(Image.fromarray((rng.random((G, G)) * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(1.2)), dtype=np.float32) / 255.0
glove = 0.86 + (grain - 0.5) * 0.16 + (noise(G, 48, 3) - 0.5) * 0.05
save("glove_basecolor.png", np.stack([glove * 240, glove * 236, glove * 228], axis=-1))

# Belt: dark brown leather grain.
B = 256
belt_grain = np.asarray(Image.fromarray((rng.random((B, B)) * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(0.9)), dtype=np.float32) / 255.0
belt = 0.8 + (belt_grain - 0.5) * 0.35
brown = np.array([62, 42, 30], dtype=np.float32)
save("belt_basecolor.png", brown[None, None, :] * belt[..., None])
print("wrote textures to", out_dir)
