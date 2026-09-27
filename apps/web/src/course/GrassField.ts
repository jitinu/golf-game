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
      return 0.32;
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

function grassAtlas(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    context.clearRect(0, 0, size, size);
    for (let blade = 0; blade < 9; blade += 1) {
      const x = 20 + blade * 27 + hash(blade * 3.3) * 8;
      const height = size * (0.55 + hash(blade * 1.7) * 0.4);
      const lean = (hash(blade * 5.1) - 0.5) * 60;
      const light = 36 + hash(blade * 2.9) * 18;
      context.fillStyle = `hsl(${96 + hash(blade) * 22}, 52%, ${light}%)`;
      context.beginPath();
      context.moveTo(x - 6, size);
      context.quadraticCurveTo(x + lean * 0.4, size - height * 0.5, x + lean, size - height);
      context.quadraticCurveTo(x + lean * 0.4 + 4, size - height * 0.5, x + 6, size);
      context.closePath();
      context.fill();
    }
  }
  const pixels = context?.getImageData(0, 0, size, size).data ?? new Uint8ClampedArray(size * size * 4);
  const texture = new THREE.DataTexture(new Uint8Array(pixels.buffer), size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
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
      varying vec2 vUv;
      varying vec3 vTint;
      varying float vHeight;
      varying float vFogDepth;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      uniform float time;
      void main() {
        vUv = uv;
        vTint = tint;
        vHeight = position.y;
        vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vec3 cardNormal = normalize((modelMatrix * instanceMatrix * vec4(normal, 0.0)).xyz);
        vNormal = normalize(mix(cardNormal, vec3(0.0, 1.0, 0.0), 0.65));
        vViewDir = normalize(cameraPosition - world.xyz);
        float h2 = position.y * position.y;
        float gust = sin(time * 1.7 + phase + world.x * 0.15 + world.z * 0.11);
        float flutter = sin(time * 4.3 + phase * 2.1) * 0.25;
        world.x += (lean + (gust + flutter) * 0.12) * h2;
        world.z += (gust * 0.06 + cos(phase) * lean * 0.5) * h2;
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
        float ao = mix(0.4, 1.0, vHeight);
        vec3 n = gl_FrontFacing ? vNormal : -vNormal;
        n = normalize(mix(n, vec3(0.0, 1.0, 0.0), 0.5));
        float diffuse = max(dot(n, sunDirection), 0.0);
        // Thin blades transmit light: brighten tips when the sun is behind them.
        float translucency = pow(max(dot(-vViewDir, sunDirection), 0.0), 3.0) * vHeight * 0.35;
        vec3 sun = vec3(1.0, 0.95, 0.86) * (diffuse * 0.75 + translucency);
        vec3 sky = vec3(0.62, 0.72, 0.8) * 0.45;
        vec3 color = tex.rgb * vTint * (sun + sky) * ao * 1.6;
        // Far blades lose contrast so sparse distant clusters read as ground texture rather than speckle.
        color = mix(color, color * 1.35 + vec3(0.02, 0.04, 0.01), smoothstep(12.0, 55.0, vFogDepth));
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
      const tints = new Float32Array(count * 3);
      for (let index = 0; index < count; index += 1) {
        phases[index] = hash(index * 8.2 + ring) * Math.PI * 2;
        leans[index] = (hash(index * 6.2 + ring) - 0.5) * 0.3;
      }
      mesh.geometry.setAttribute('phase', new THREE.InstancedBufferAttribute(phases, 1));
      mesh.geometry.setAttribute('lean', new THREE.InstancedBufferAttribute(leans, 1));
      mesh.geometry.setAttribute('tint', new THREE.InstancedBufferAttribute(tints, 3));
      this.materials.push(material);
      this.rings.push({ mesh, radius, tints });
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
    const { mesh, radius, tints } = ring;
    const cx = Math.round(this.center.x);
    const cz = Math.round(this.center.z);
    for (let index = 0; index < mesh.count; index += 1) {
      const seed = index * 3.1 + ringIndex * 17;
      const angle = hash(seed) * Math.PI * 2;
      const r = Math.sqrt(hash(seed + 1) * (radius * radius - inner * inner) + inner * inner);
      const x = cx + Math.cos(angle) * r;
      const z = cz + Math.sin(angle) * r;
      const surface = this.course.surfaceMask.surfaceAt(x, z);
      const grow = grassy(surface);
      const height = grow ? surfaceHeight(surface) * (0.8 + hash(seed + 2) * 0.5) * (ringIndex === 2 ? 0.85 : 1) : 0;
      const width = 0.25 + hash(seed + 3) * 0.25 + ringIndex * 0.12;
      this.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(seed + 4) * Math.PI * 2);
      this.scale.set(width, height, width);
      this.position.set(x, this.course.sampler.heightAt(x, z) - 0.01, z);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      mesh.setMatrixAt(index, this.matrix);
      const dry = hash(seed + 5);
      const shade = 0.8 + hash(seed + 6) * 0.3;
      tints[index * 3] = (0.7 + dry * 0.3) * shade;
      tints[index * 3 + 1] = (0.92 + dry * 0.08) * shade;
      tints[index * 3 + 2] = (0.5 + dry * 0.15) * shade;
    }
    mesh.instanceMatrix.needsUpdate = true;
    const tintAttribute = mesh.geometry.getAttribute('tint');
    if (tintAttribute instanceof THREE.InstancedBufferAttribute) tintAttribute.needsUpdate = true;
  }
}
