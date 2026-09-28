import * as THREE from 'three';
import type { Environment } from '../render/Environment.js';

/** Render layers, indexed by SurfaceId (Water and OutOfBounds fall back to rough; water is covered by the water plane). */
export const REGION_NAMES = ['green', 'fairway', 'firstcut', 'rough', 'bunker', 'dirt', 'path'] as const;
const SURFACE_TO_LAYER = [0, 1, 2, 3, 4, 3, 5, 6, 3];
const PROCEDURAL_SIZE = 512;
const TEXTURE_SIZE = 1024;
const TEXTURE_ROOT = '/textures/terrain';
/** World metres covered by one texture tile per layer (ambientCG sets are authored at roughly 1–2 m). */
const LAYER_TILE_M = [1.1, 1.6, 1.8, 2.2, 2.4, 2.0, 1.6];

interface RegionStyle {
  base: [number, number, number];
  variance: number;
  grain: number;
  roughness: number;
  bump: number;
}

const REGION_STYLES: RegionStyle[] = [
  { base: [0.22, 0.46, 0.17], variance: 0.05, grain: 26, roughness: 0.78, bump: 0.15 }, // green: tight, striped
  { base: [0.24, 0.5, 0.18], variance: 0.09, grain: 14, roughness: 0.86, bump: 0.3 }, // fairway
  { base: [0.27, 0.47, 0.16], variance: 0.12, grain: 9, roughness: 0.9, bump: 0.45 }, // first cut
  { base: [0.3, 0.42, 0.16], variance: 0.16, grain: 6, roughness: 0.94, bump: 0.6 }, // rough
  { base: [0.82, 0.74, 0.55], variance: 0.07, grain: 40, roughness: 0.92, bump: 0.35 }, // bunker
  { base: [0.42, 0.33, 0.22], variance: 0.14, grain: 12, roughness: 0.9, bump: 0.5 }, // dirt
  { base: [0.56, 0.55, 0.5], variance: 0.06, grain: 30, roughness: 0.7, bump: 0.25 }, // path
];

function hash2(x: number, y: number): number {
  const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/** Tileable value noise on a PROCEDURAL_SIZE torus. */
function valueNoise(x: number, y: number, cells: number): number {
  const fx = (x / PROCEDURAL_SIZE) * cells;
  const fy = (y / PROCEDURAL_SIZE) * cells;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const wrap = (v: number) => ((v % cells) + cells) % cells;
  const n00 = hash2(wrap(x0), wrap(y0));
  const n10 = hash2(wrap(x0 + 1), wrap(y0));
  const n01 = hash2(wrap(x0), wrap(y0 + 1));
  const n11 = hash2(wrap(x0 + 1), wrap(y0 + 1));
  return (n00 * (1 - sx) + n10 * sx) * (1 - sy) + (n01 * (1 - sx) + n11 * sx) * sy;
}

function fbm(x: number, y: number, baseCells: number): number {
  return valueNoise(x, y, baseCells) * 0.5 + valueNoise(x, y, baseCells * 2) * 0.25 + valueNoise(x, y, baseCells * 4) * 0.125 + valueNoise(x, y, baseCells * 8) * 0.125;
}

interface Layers {
  albedo: THREE.DataArrayTexture;
  normalRough: THREE.DataArrayTexture;
}

function configureArray(texture: THREE.DataArrayTexture): void {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
}

let cachedProcedural: Layers | undefined;

/** Procedural stand-in layers shown until the authored sets have streamed in (and if they are missing). */
function buildProceduralLayers(): Layers {
  if (cachedProcedural) return cachedProcedural;
  const size = PROCEDURAL_SIZE;
  const layers = REGION_STYLES.length;
  const albedoData = new Uint8Array(size * size * layers * 4);
  const normalData = new Uint8Array(size * size * layers * 4);
  const heights = new Float32Array(size * size);
  REGION_STYLES.forEach((style, layer) => {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const height = fbm(x + layer * 97, y + layer * 41, style.grain);
        heights[y * size + x] = height;
        const shade = 1 - style.variance + height * style.variance * 2;
        const offset = (layer * size * size + y * size + x) * 4;
        albedoData[offset] = Math.min(255, style.base[0] * shade * 255);
        albedoData[offset + 1] = Math.min(255, style.base[1] * shade * 255);
        albedoData[offset + 2] = Math.min(255, style.base[2] * shade * 255);
        albedoData[offset + 3] = 255;
      }
    }
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const at = (px: number, py: number) => heights[((py + size) % size) * size + ((px + size) % size)] ?? 0;
        const dx = (at(x + 1, y) - at(x - 1, y)) * style.bump * 4;
        const dy = (at(x, y + 1) - at(x, y - 1)) * style.bump * 4;
        const length = Math.hypot(dx, dy, 1);
        const offset = (layer * size * size + y * size + x) * 4;
        normalData[offset] = ((-dx / length) * 0.5 + 0.5) * 255;
        normalData[offset + 1] = ((-dy / length) * 0.5 + 0.5) * 255;
        normalData[offset + 2] = ((1 / length) * 0.5 + 0.5) * 255;
        normalData[offset + 3] = style.roughness * 255;
      }
    }
  });
  const albedo = new THREE.DataArrayTexture(albedoData, size, size, layers);
  albedo.colorSpace = THREE.SRGBColorSpace;
  const normalRough = new THREE.DataArrayTexture(normalData, size, size, layers);
  configureArray(albedo);
  configureArray(normalRough);
  cachedProcedural = { albedo, normalRough };
  return cachedProcedural;
}

async function loadPixels(url: string, size: number): Promise<Uint8ClampedArray | undefined> {
  try {
    const response = await fetch(url);
    if (!response.ok || (response.headers.get('content-type') ?? '').includes('text/html')) return undefined;
    const bitmap = await createImageBitmap(await response.blob(), { resizeWidth: size, resizeHeight: size, resizeQuality: 'high' });
    const canvas = new OffscreenCanvas(size, size);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return undefined;
    context.drawImage(bitmap, 0, 0, size, size);
    bitmap.close();
    return context.getImageData(0, 0, size, size).data;
  } catch {
    return undefined;
  }
}

let authoredLayers: Promise<Layers | undefined> | undefined;

/**
 * Loads `<region>_color.jpg`, `<region>_normal.jpg` (OpenGL +Y) and `<region>_rough_ao.jpg` (R = roughness, G = AO)
 * for every region into two texture arrays: albedo×AO and normal+roughness. Resolves undefined if any set is missing.
 */
function loadAuthoredLayers(): Promise<Layers | undefined> {
  authoredLayers ??= (async () => {
    const size = TEXTURE_SIZE;
    const layers = REGION_NAMES.length;
    const albedoData = new Uint8Array(size * size * layers * 4);
    const normalData = new Uint8Array(size * size * layers * 4);
    const results = await Promise.all(
      REGION_NAMES.map(async (region) => ({
        color: await loadPixels(`${TEXTURE_ROOT}/${region}_color.jpg`, size),
        normal: await loadPixels(`${TEXTURE_ROOT}/${region}_normal.jpg`, size),
        roughAo: await loadPixels(`${TEXTURE_ROOT}/${region}_rough_ao.jpg`, size),
      })),
    );
    if (results.some((set) => !set.color || !set.normal || !set.roughAo)) return undefined;
    results.forEach((set, layer) => {
      const base = layer * size * size * 4;
      const color = set.color!;
      const normal = set.normal!;
      const roughAo = set.roughAo!;
      for (let index = 0; index < size * size * 4; index += 4) {
        const ao = 0.6 + (roughAo[index + 1]! / 255) * 0.4;
        albedoData[base + index] = color[index]! * ao;
        albedoData[base + index + 1] = color[index + 1]! * ao;
        albedoData[base + index + 2] = color[index + 2]! * ao;
        albedoData[base + index + 3] = 255;
        normalData[base + index] = normal[index]!;
        normalData[base + index + 1] = normal[index + 1]!;
        normalData[base + index + 2] = normal[index + 2]!;
        normalData[base + index + 3] = roughAo[index]!;
      }
    });
    const albedo = new THREE.DataArrayTexture(albedoData, size, size, layers);
    albedo.colorSpace = THREE.SRGBColorSpace;
    const normalRough = new THREE.DataArrayTexture(normalData, size, size, layers);
    configureArray(albedo);
    configureArray(normalRough);
    return { albedo, normalRough };
  })();
  return authoredLayers;
}

const SURFACE_TO_LAYER_GLSL = `const float SURFACE_TO_LAYER[9] = float[9](${SURFACE_TO_LAYER.map((v) => `${v}.0`).join(', ')});`;
const LAYER_TILE_GLSL = `const float LAYER_TILE[7] = float[7](${LAYER_TILE_M.map((v) => `${(1 / v).toFixed(4)}`).join(', ')});`;

/**
 * Splat material: the gameplay surface.u8 mask is sampled in world space, the four surrounding
 * cells are each mapped to a PBR layer and blended with bilinear weights, and two tiling scales
 * are mixed to hide repetition. Mown surfaces get alternating stripes and a slow macro tint
 * variation; water-adjacent cells are darkened for a wet shoreline.
 */
export function createTerrainMaterial(mask: THREE.DataTexture, maskOrigin: THREE.Vector2, maskExtent: THREE.Vector2, environment?: Environment): THREE.MeshStandardMaterial {
  const procedural = buildProceduralLayers();
  const uniforms = {
    splatMask: { value: mask },
    regionAlbedo: { value: procedural.albedo as THREE.Texture },
    regionNormalRough: { value: procedural.normalRough as THREE.Texture },
    maskOrigin: { value: maskOrigin },
    maskExtent: { value: maskExtent },
  };
  void loadAuthoredLayers().then((layers) => {
    if (!layers) return;
    uniforms.regionAlbedo.value = layers.albedo;
    uniforms.regionNormalRough.value = layers.normalRough;
  });
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTerrainWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTerrainWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vTerrainWorld;
        uniform sampler2D splatMask;
        uniform sampler2DArray regionAlbedo;
        uniform sampler2DArray regionNormalRough;
        uniform vec2 maskOrigin;
        uniform vec2 maskExtent;
        ${SURFACE_TO_LAYER_GLSL}
        ${LAYER_TILE_GLSL}
        float terrainLayer(vec2 cell, vec2 texel) {
          float id = texture2D(splatMask, (cell + 0.5) * texel).r * 255.0;
          return SURFACE_TO_LAYER[int(clamp(id + 0.5, 0.0, 8.0))];
        }
        vec4 terrainSample(sampler2DArray atlas, float layer, vec2 world) {
          float tile = LAYER_TILE[int(layer + 0.5)];
          vec4 near = texture(atlas, vec3(world * tile, layer));
          vec4 far = texture(atlas, vec3(world * tile * 0.23 + vec2(0.31, 0.17), layer));
          return mix(near, far, 0.3);
        }
        float terrainHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float terrainNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(terrainHash(i), terrainHash(i + vec2(1.0, 0.0)), u.x), mix(terrainHash(i + vec2(0.0, 1.0)), terrainHash(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        float terrainRoughness = 0.9;
        vec3 terrainNormal = vec3(0.0, 0.0, 1.0);`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec2 maskUv = (vTerrainWorld.xz - maskOrigin) / maskExtent;
          vec2 maskSize = vec2(textureSize(splatMask, 0));
          vec2 cell = maskUv * maskSize - 0.5;
          vec2 baseCell = floor(cell);
          vec2 f = fract(cell);
          vec2 texel = 1.0 / maskSize;
          float l00 = terrainLayer(baseCell, texel);
          float l10 = terrainLayer(baseCell + vec2(1.0, 0.0), texel);
          float l01 = terrainLayer(baseCell + vec2(0.0, 1.0), texel);
          float l11 = terrainLayer(baseCell + vec2(1.0, 1.0), texel);
          vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
          vec2 world = vTerrainWorld.xz;
          vec4 albedoMix = terrainSample(regionAlbedo, l00, world) * w.x + terrainSample(regionAlbedo, l10, world) * w.y + terrainSample(regionAlbedo, l01, world) * w.z + terrainSample(regionAlbedo, l11, world) * w.w;
          vec4 nrMix = terrainSample(regionNormalRough, l00, world) * w.x + terrainSample(regionNormalRough, l10, world) * w.y + terrainSample(regionNormalRough, l01, world) * w.z + terrainSample(regionNormalRough, l11, world) * w.w;
          float water = 0.0;
          for (int dz = -1; dz <= 1; dz++) {
            for (int dx = -1; dx <= 1; dx++) {
              float id = texture2D(splatMask, (baseCell + vec2(float(dx), float(dz)) + 0.5) * texel).r * 255.0;
              water += step(4.5, id) * step(id, 5.5);
            }
          }
          float wet = clamp(water / 4.0, 0.0, 1.0);
          // Mower stripes weighted by how much of the blend is mown.
          float mown = w.x * step(l00, 1.5) + w.y * step(l10, 1.5) + w.z * step(l01, 1.5) + w.w * step(l11, 1.5);
          float greenShare = w.x * step(l00, 0.5) + w.y * step(l10, 0.5) + w.z * step(l01, 0.5) + w.w * step(l11, 0.5);
          float roughShare = w.x * step(2.5, l00) * step(l00, 3.5) + w.y * step(2.5, l10) * step(l10, 3.5) + w.z * step(2.5, l01) * step(l01, 3.5) + w.w * step(2.5, l11) * step(l11, 3.5);
          // Fairways are mown in 8 m diagonal passes; greens get a tight checkerboard (two perpendicular passes).
          float fairwayStripe = step(0.5, fract((world.x - world.y) / 8.0));
          float greenStripe = abs(step(0.5, fract(world.x / 2.4)) - step(0.5, fract(world.y / 2.4)));
          float stripe = mix(fairwayStripe, greenStripe, greenShare);
          float stripeShade = 1.0 + (stripe - 0.5) * mix(0.14, 0.09, greenShare) * mown;
          // Slow macro variation so large areas do not read as one flat tone, plus drier straw-toned patches
          // (strongest in the rough) and 1–2 m clumps that break the rough into tussocks.
          float macro = 0.93 + 0.14 * terrainNoise(world * 0.035) * (0.5 + 0.5 * terrainNoise(world * 0.011 + 3.7));
          float dry = smoothstep(0.5, 0.85, terrainNoise(world * 0.021 + 7.1)) * mix(0.18, 0.5, roughShare);
          float clumps = 1.0 - roughShare * 0.14 * terrainNoise(world * 0.7 + 1.3) - roughShare * 0.08 * terrainNoise(world * 2.3);
          vec3 albedo = mix(albedoMix.rgb, albedoMix.rgb * vec3(1.14, 1.05, 0.72), dry);
          diffuseColor.rgb = albedo * stripeShade * macro * clumps * (1.0 - wet * 0.35);
          // Turf and sand are matte; keep the authored roughness maps as variation on top of a high floor.
          terrainRoughness = (0.72 + 0.28 * nrMix.a) * (1.0 - wet * 0.4);
          terrainNormal = normalize(nrMix.xyz * 2.0 - 1.0);
        }`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = terrainRoughness;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          // View-space tangent frame from world xz derivatives (the detail maps tile in world xz).
          vec3 q0 = dFdx(-vViewPosition);
          vec3 q1 = dFdy(-vViewPosition);
          vec2 st0 = dFdx(vTerrainWorld.xz);
          vec2 st1 = dFdy(vTerrainWorld.xz);
          vec3 N = normalize(normal);
          vec3 q1perp = cross(q1, N);
          vec3 q0perp = cross(N, q0);
          vec3 T = q1perp * st0.x + q0perp * st1.x;
          vec3 B = q1perp * st0.y + q0perp * st1.y;
          float det = max(dot(T, T), dot(B, B));
          float scale = det == 0.0 ? 0.0 : inversesqrt(det);
          // Fade the detail normal out with distance so far turf does not sparkle.
          float detailStrength = 0.7 * (1.0 - smoothstep(60.0, 220.0, length(vViewPosition)));
          normal = normalize(T * (terrainNormal.x * detailStrength * scale) + B * (terrainNormal.y * detailStrength * scale) + N * terrainNormal.z);
        }`,
      );
  };
  material.customProgramCacheKey = () => 'terrain-splat';
  environment?.setupMaterial(material);
  return material;
}
