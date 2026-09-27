import * as THREE from 'three';
import type { Environment } from '../render/Environment.js';

/** Render layers, indexed by SurfaceId (Water and OutOfBounds fall back to rough; water is covered by the water plane). */
export const REGION_NAMES = ['green', 'fairway', 'firstcut', 'rough', 'bunker', 'dirt', 'path'] as const;
const SURFACE_TO_LAYER = [0, 1, 2, 3, 4, 3, 5, 6, 3];
const TEXTURE_SIZE = 512;

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

/** Tileable value noise on a TEXTURE_SIZE torus. */
function valueNoise(x: number, y: number, cells: number): number {
  const fx = (x / TEXTURE_SIZE) * cells;
  const fy = (y / TEXTURE_SIZE) * cells;
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

let cachedAlbedo: THREE.DataArrayTexture | undefined;
let cachedNormalRough: THREE.DataArrayTexture | undefined;

/** Procedural PBR layers. Real Poly Haven / ambientCG sets replace these via the asset pipeline (see docs/assets.md). */
function buildLayers(): { albedo: THREE.DataArrayTexture; normalRough: THREE.DataArrayTexture } {
  if (cachedAlbedo && cachedNormalRough) return { albedo: cachedAlbedo, normalRough: cachedNormalRough };
  const layers = REGION_STYLES.length;
  const albedoData = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * layers * 4);
  const normalData = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * layers * 4);
  const heights = new Float32Array(TEXTURE_SIZE * TEXTURE_SIZE);
  REGION_STYLES.forEach((style, layer) => {
    for (let y = 0; y < TEXTURE_SIZE; y += 1) {
      for (let x = 0; x < TEXTURE_SIZE; x += 1) {
        let height = fbm(x + layer * 97, y + layer * 41, style.grain);
        if (layer === 0) height = height * 0.7 + 0.3 * (0.5 + 0.5 * Math.sin((x / TEXTURE_SIZE) * Math.PI * 16)) * 0.35; // mower stripes
        heights[y * TEXTURE_SIZE + x] = height;
        const shade = 1 - style.variance + height * style.variance * 2;
        const offset = (layer * TEXTURE_SIZE * TEXTURE_SIZE + y * TEXTURE_SIZE + x) * 4;
        albedoData[offset] = Math.min(255, style.base[0] * shade * 255);
        albedoData[offset + 1] = Math.min(255, style.base[1] * shade * 255);
        albedoData[offset + 2] = Math.min(255, style.base[2] * shade * 255);
        albedoData[offset + 3] = 255;
      }
    }
    for (let y = 0; y < TEXTURE_SIZE; y += 1) {
      for (let x = 0; x < TEXTURE_SIZE; x += 1) {
        const at = (px: number, py: number) => heights[((py + TEXTURE_SIZE) % TEXTURE_SIZE) * TEXTURE_SIZE + ((px + TEXTURE_SIZE) % TEXTURE_SIZE)] ?? 0;
        const dx = (at(x + 1, y) - at(x - 1, y)) * style.bump * 4;
        const dy = (at(x, y + 1) - at(x, y - 1)) * style.bump * 4;
        const length = Math.hypot(dx, dy, 1);
        const offset = (layer * TEXTURE_SIZE * TEXTURE_SIZE + y * TEXTURE_SIZE + x) * 4;
        normalData[offset] = ((-dx / length) * 0.5 + 0.5) * 255;
        normalData[offset + 1] = ((-dy / length) * 0.5 + 0.5) * 255;
        normalData[offset + 2] = ((1 / length) * 0.5 + 0.5) * 255;
        normalData[offset + 3] = style.roughness * 255;
      }
    }
  });
  const albedo = new THREE.DataArrayTexture(albedoData, TEXTURE_SIZE, TEXTURE_SIZE, layers);
  albedo.colorSpace = THREE.SRGBColorSpace;
  const normalRough = new THREE.DataArrayTexture(normalData, TEXTURE_SIZE, TEXTURE_SIZE, layers);
  for (const texture of [albedo, normalRough]) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
  }
  cachedAlbedo = albedo;
  cachedNormalRough = normalRough;
  return { albedo, normalRough };
}

const SURFACE_TO_LAYER_GLSL = `const float SURFACE_TO_LAYER[9] = float[9](${SURFACE_TO_LAYER.map((v) => `${v}.0`).join(', ')});`;

/**
 * Splat material: the gameplay surface.u8 mask is sampled in world space, the four surrounding
 * cells are each mapped to a PBR layer and blended with bilinear weights, and two tiling scales
 * are mixed to hide repetition. Water-adjacent cells are darkened for a wet shoreline.
 */
export function createTerrainMaterial(mask: THREE.DataTexture, maskOrigin: THREE.Vector2, maskExtent: THREE.Vector2, environment?: Environment): THREE.MeshStandardMaterial {
  const { albedo, normalRough } = buildLayers();
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.splatMask = { value: mask };
    shader.uniforms.regionAlbedo = { value: albedo };
    shader.uniforms.regionNormalRough = { value: normalRough };
    shader.uniforms.maskOrigin = { value: maskOrigin };
    shader.uniforms.maskExtent = { value: maskExtent };
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
        float terrainLayer(vec2 cell, vec2 texel) {
          float id = texture2D(splatMask, (cell + 0.5) * texel).r * 255.0;
          return SURFACE_TO_LAYER[int(clamp(id + 0.5, 0.0, 8.0))];
        }
        vec4 terrainSample(sampler2DArray atlas, float layer, vec2 world) {
          vec4 near = texture(atlas, vec3(world * 0.5, layer));
          vec4 far = texture(atlas, vec3(world * 0.07 + vec2(0.31, 0.17), layer));
          return mix(near, far, 0.35);
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
          for (int dz = -2; dz <= 2; dz++) {
            for (int dx = -2; dx <= 2; dx++) {
              float id = texture2D(splatMask, (baseCell + vec2(float(dx), float(dz)) + 0.5) * texel).r * 255.0;
              water += step(4.5, id) * step(id, 5.5);
            }
          }
          float wet = clamp(water / 8.0, 0.0, 1.0);
          diffuseColor.rgb = albedoMix.rgb * (1.0 - wet * 0.35);
          terrainRoughness = nrMix.a * (1.0 - wet * 0.4);
          terrainNormal = normalize(nrMix.xyz * 2.0 - 1.0);
        }`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = terrainRoughness;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec3 q0 = dFdx(vTerrainWorld);
          vec3 q1 = dFdy(vTerrainWorld);
          vec2 st0 = dFdx(vTerrainWorld.xz);
          vec2 st1 = dFdy(vTerrainWorld.xz);
          vec3 N = normalize(normal);
          vec3 T = normalize(q0 * st1.y - q1 * st0.y);
          vec3 B = -normalize(cross(N, T));
          mat3 tbn = mat3(T, B, N);
          normal = normalize(tbn * vec3(terrainNormal.xy * 0.6, terrainNormal.z));
        }`,
      );
  };
  material.customProgramCacheKey = () => 'terrain-splat';
  environment?.setupMaterial(material);
  return material;
}
