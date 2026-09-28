import * as THREE from 'three';
import { SurfaceId, type LoadedCourse } from '@golf/course-format';
import type { GraphicsPreset } from '../app/GraphicsPreset.js';

const RING_RADII = [15, 35, 60];
const RING_SHARES = [0.5, 0.32, 0.18];
const RECENTER_DISTANCE = 6;

function hash(value: number): number {
  const x = Math.sin(value * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function hash2(x: number, z: number, salt: number): number {
  return hash(x * 127.1 + z * 311.7 + salt * 74.7);
}

/** Smooth value noise in [0, 1] over world metres; drives patch-scale density, tone and comb direction. */
function valueNoise(x: number, z: number, scale: number, salt: number): number {
  const u = x / scale;
  const v = z / scale;
  const x0 = Math.floor(u);
  const z0 = Math.floor(v);
  const fx = u - x0;
  const fz = v - z0;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(x0, z0, salt);
  const b = hash2(x0 + 1, z0, salt);
  const c = hash2(x0, z0 + 1, salt);
  const d = hash2(x0 + 1, z0 + 1, salt);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

const ATLAS_VARIANTS = 4;

function grassy(surface: SurfaceId): boolean {
  return surface === SurfaceId.Green || surface === SurfaceId.Fairway || surface === SurfaceId.FirstCut || surface === SurfaceId.Rough;
}

function surfaceHeight(surface: SurfaceId): number {
  switch (surface) {
    case SurfaceId.Green:
      return 0.03;
    case SurfaceId.Fairway:
      return 0.07;
    case SurfaceId.FirstCut:
      return 0.15;
    default:
      return 0.26;
  }
}

/** Three crossed alpha cards forming one grass cluster, base at y = 0, unit height. */
function clusterGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let card = 0; card < 3; card += 1) {
    const angle = (card / 3) * Math.PI;
    const dx = Math.cos(angle) * 0.5;
    const dz = Math.sin(angle) * 0.5;
    const nx = -Math.sin(angle);
    const nz = Math.cos(angle);
    const base = card * 4;
    positions.push(-dx, 0, -dz, dx, 0, dz, dx, 1, dz, -dx, 1, -dz);
    for (let corner = 0; corner < 4; corner += 1) normals.push(nx, 0, nz);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * Four tufts side by side, each a dozen thin blades with a base→tip lightness gradient and darker edges, so
 * clusters read as individual blades up close instead of solid triangles.
 */
function grassAtlas(): THREE.Texture {
  const size = 256;
  const width = size * ATLAS_VARIANTS;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    context.clearRect(0, 0, width, size);
    for (let variant = 0; variant < ATLAS_VARIANTS; variant += 1) {
      const origin = variant * size;
      const blades = 11 + variant * 2;
      for (let blade = 0; blade < blades; blade += 1) {
        const seed = variant * 100 + blade;
        const x = origin + 24 + ((blade + 0.5) / blades) * (size - 48) + (hash(seed * 3.3) - 0.5) * 14;
        const height = size * (0.5 + hash(seed * 1.7) * 0.45);
        const lean = (hash(seed * 5.1) - 0.5) * 90;
        const halfWidth = 2.5 + hash(seed * 7.7) * 3;
        const hue = 76 + hash(seed) * 22;
        const light = 43 + hash(seed * 2.9) * 14;
        // Base→tip gradient: shaded near the soil, lit at the tip, with the same yellow-green hue as the turf albedo.
        const gradient = context.createLinearGradient(0, size, 0, size - height);
        gradient.addColorStop(0, `hsl(${hue}, 42%, ${light - 6}%)`);
        gradient.addColorStop(0.55, `hsl(${hue}, 46%, ${light}%)`);
        gradient.addColorStop(1, `hsl(${hue + 4}, 50%, ${light + 12}%)`);
        context.fillStyle = gradient;
        context.beginPath();
        context.moveTo(x - halfWidth, size);
        context.quadraticCurveTo(x + lean * 0.35 - halfWidth * 0.5, size - height * 0.55, x + lean, size - height);
        context.quadraticCurveTo(x + lean * 0.35 + halfWidth * 0.5, size - height * 0.55, x + halfWidth, size);
        context.closePath();
        context.fill();
        // Thin dark midrib for silhouette definition.
        context.strokeStyle = `hsla(${hue}, 40%, ${light - 12}%, 0.3)`;
        context.lineWidth = 0.7;
        context.beginPath();
        context.moveTo(x, size);
        context.quadraticCurveTo(x + lean * 0.35, size - height * 0.55, x + lean, size - height);
        context.stroke();
      }
    }
  }
  const pixels = context?.getImageData(0, 0, width, size).data ?? new Uint8ClampedArray(width * size * 4);
  const texture = new THREE.DataTexture(new Uint8Array(pixels.buffer), width, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.flipY = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

function grassMaterial(atlas: THREE.Texture, fog: THREE.FogExp2 | undefined, sunDirection: THREE.Vector3): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      map: { value: atlas },
      sunDirection: { value: sunDirection.clone().normalize() },
      fogColor: { value: fog?.color ?? new THREE.Color(0x9bb5c4) },
      fogDensity: { value: fog?.density ?? 0 },
    },
    side: THREE.DoubleSide,
    transparent: false,
    alphaTest: 0.4,
    vertexShader: `
      attribute float phase;
      attribute float lean;
      attribute vec3 tint;
      attribute vec2 comb;
      attribute float variant;
      varying vec2 vUv;
      varying vec3 vTint;
      varying float vHeight;
      varying float vFogDepth;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      uniform float time;
      void main() {
        vUv = vec2((uv.x + variant) / ${ATLAS_VARIANTS.toFixed(1)}, uv.y);
        vTint = tint;
        vHeight = position.y;
        vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vec3 cardNormal = normalize((modelMatrix * instanceMatrix * vec4(normal, 0.0)).xyz);
        vNormal = normalize(mix(cardNormal, vec3(0.0, 1.0, 0.0), 0.65));
        vViewDir = normalize(cameraPosition - world.xyz);
        float h2 = position.y * position.y;
        float gust = sin(time * 1.7 + phase + world.x * 0.15 + world.z * 0.11);
        float flutter = sin(time * 4.3 + phase * 2.1) * 0.25;
        // Patch-scale comb direction (mowing / prevailing wind) plus per-cluster lean and animated gusts.
        world.x += (comb.x + lean + (gust + flutter) * 0.12) * h2;
        world.z += (comb.y + gust * 0.06 + cos(phase) * lean * 0.5) * h2;
        vec4 view = viewMatrix * world;
        vFogDepth = -view.z;
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vTint;
      varying float vHeight;
      varying float vFogDepth;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      uniform sampler2D map;
      uniform vec3 fogColor;
      uniform float fogDensity;
      uniform vec3 sunDirection;
      void main() {
        vec4 tex = texture2D(map, vUv);
        if (tex.a < 0.4) discard;
        float ao = mix(0.68, 1.0, vHeight);
        vec3 n = gl_FrontFacing ? vNormal : -vNormal;
        n = normalize(mix(n, vec3(0.0, 1.0, 0.0), 0.7));
        float diffuse = max(dot(n, sunDirection), 0.0);
        // Thin blades transmit light: brighten tips when the sun is behind them.
        float translucency = pow(max(dot(-vViewDir, sunDirection), 0.0), 3.0) * vHeight * 0.35;
        vec3 sun = vec3(1.0, 0.95, 0.86) * (diffuse * 0.75 + translucency);
        vec3 sky = vec3(0.62, 0.72, 0.8) * 0.55;
        vec3 color = tex.rgb * vTint * (sun + sky) * ao * 1.25;
        // Far blades lose contrast so sparse distant clusters read as ground texture rather than speckle.
        color = mix(color, color * 1.15 + vec3(0.01, 0.02, 0.005), smoothstep(12.0, 55.0, vFogDepth));
        float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
        gl_FragColor = vec4(mix(color, fogColor, fogFactor), 1.0);
      }
    `,
  });
}

interface Ring {
  mesh: THREE.InstancedMesh;
  radius: number;
  tints: Float32Array;
  combs: Float32Array;
}

/** Camera-centred LOD rings of instanced grass clusters; the mask decides where grass grows. */
export class GrassField {
  readonly group = new THREE.Group();
  private readonly rings: Ring[] = [];
  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly center = new THREE.Vector3(Number.NaN, 0, Number.NaN);
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly position = new THREE.Vector3();

  constructor(
    private readonly course: LoadedCourse,
    preset: GraphicsPreset,
    fog?: THREE.FogExp2,
    sunDirection: THREE.Vector3 = new THREE.Vector3(0.4, 0.8, 0.3),
  ) {
    const atlas = grassAtlas();
    const geometry = clusterGeometry();
    RING_RADII.forEach((radius, ring) => {
      const count = Math.max(1, Math.floor(preset.grassInstances * (RING_SHARES[ring] ?? 0)));
      const material = grassMaterial(atlas, fog, sunDirection);
      const mesh = new THREE.InstancedMesh(geometry.clone(), material, count);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.userData.excludeAO = true;
      const phases = new Float32Array(count);
      const leans = new Float32Array(count);
      const variants = new Float32Array(count);
      const tints = new Float32Array(count * 3);
      const combs = new Float32Array(count * 2);
      for (let index = 0; index < count; index += 1) {
        phases[index] = hash(index * 8.2 + ring) * Math.PI * 2;
        leans[index] = (hash(index * 6.2 + ring) - 0.5) * 0.3;
        variants[index] = Math.floor(hash(index * 4.7 + ring * 3) * ATLAS_VARIANTS);
      }
      mesh.geometry.setAttribute('phase', new THREE.InstancedBufferAttribute(phases, 1));
      mesh.geometry.setAttribute('lean', new THREE.InstancedBufferAttribute(leans, 1));
      mesh.geometry.setAttribute('variant', new THREE.InstancedBufferAttribute(variants, 1));
      mesh.geometry.setAttribute('tint', new THREE.InstancedBufferAttribute(tints, 3));
      mesh.geometry.setAttribute('comb', new THREE.InstancedBufferAttribute(combs, 2));
      this.materials.push(material);
      this.rings.push({ mesh, radius, tints, combs });
      this.group.add(mesh);
    });
  }

  update(cameraPosition: THREE.Vector3, time: number): void {
    if (Number.isNaN(this.center.x) || this.center.distanceTo(cameraPosition) > RECENTER_DISTANCE) {
      this.center.copy(cameraPosition);
      this.rings.forEach((ring, ringIndex) => this.scatter(ring, ringIndex));
    }
    this.materials.forEach((material) => {
      if (material.uniforms.time) material.uniforms.time.value = time;
    });
  }

  private scatter(ring: Ring, ringIndex: number): void {
    const inner = ringIndex === 0 ? 0 : (RING_RADII[ringIndex - 1] ?? 0);
    const { mesh, radius, tints, combs } = ring;
    const cx = Math.round(this.center.x);
    const cz = Math.round(this.center.z);
    for (let index = 0; index < mesh.count; index += 1) {
      const seed = index * 3.1 + ringIndex * 17;
      const angle = hash(seed) * Math.PI * 2;
      const r = Math.sqrt(hash(seed + 1) * (radius * radius - inner * inner) + inner * inner);
      const x = cx + Math.cos(angle) * r;
      const z = cz + Math.sin(angle) * r;
      const surface = this.course.surfaceMask.surfaceAt(x, z);
      // Patch-scale variation: thin/thick density, dry/lush tone and a comb direction that drifts across the course.
      const density = valueNoise(x, z, 9, 1) * 0.6 + valueNoise(x, z, 2.5, 2) * 0.4;
      const lush = valueNoise(x, z, 14, 3);
      const thinCut = surface === SurfaceId.Green || surface === SurfaceId.Fairway;
      const grow = grassy(surface) && density > (thinCut ? 0.42 : 0.28) - (ringIndex === 0 ? 0.1 : 0);
      const height = grow
        ? surfaceHeight(surface) * (0.75 + hash(seed + 2) * 0.5) * (0.85 + density * 0.3) * (ringIndex === 2 ? 0.85 : 1)
        : 0;
      const width = 0.22 + hash(seed + 3) * 0.28 + ringIndex * 0.12;
      this.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(seed + 4) * Math.PI * 2);
      this.scale.set(width, height, width);
      this.position.set(x, this.course.sampler.heightAt(x, z) - 0.01, z);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      mesh.setMatrixAt(index, this.matrix);
      const dry = hash(seed + 5) * 0.5 + (1 - lush) * 0.5;
      const shade = (0.82 + hash(seed + 6) * 0.26) * (0.9 + lush * 0.2);
      tints[index * 3] = (0.68 + dry * 0.34) * shade;
      tints[index * 3 + 1] = (0.9 + dry * 0.1) * shade;
      tints[index * 3 + 2] = (0.48 + dry * 0.14) * shade;
      const combAngle = valueNoise(x, z, 22, 4) * Math.PI * 2;
      const combStrength = 0.08 + valueNoise(x, z, 6, 5) * 0.18;
      combs[index * 2] = Math.cos(combAngle) * combStrength;
      combs[index * 2 + 1] = Math.sin(combAngle) * combStrength;
    }
    mesh.instanceMatrix.needsUpdate = true;
    for (const name of ['tint', 'comb']) {
      const attribute = mesh.geometry.getAttribute(name);
      if (attribute instanceof THREE.InstancedBufferAttribute) attribute.needsUpdate = true;
    }
  }
}
