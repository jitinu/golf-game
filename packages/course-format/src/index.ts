import { SurfaceId, type Cup, type TerrainSampler, type Vec3 } from '@golf/sim';

export { SurfaceId };
export type { Cup, TerrainSampler, Vec3 };

export interface CourseManifest {
  courseId: string;
  courseVersion: number;
  physicsVersion: number;
  name: string;
  description?: string;
  heightfield: {
    width: number;
    depth: number;
    cellSize: number;
    origin: { x: number; z: number };
    minHeight: number;
    maxHeight: number;
    file: 'terrain.height.f32';
  };
  surfaceMask: {
    file: 'surface.u8';
    width: number;
    depth: number;
    cellSize: number;
    origin: { x: number; z: number };
  };
  holes: HoleDef[];
  features: CourseFeatures;
  environment?: { sunAzimuthDeg: number; sunElevationDeg: number; hdri?: 'limpopo_golf_course' };
}

export interface HoleDef {
  number: number;
  par: number;
  tees: { id: 'back' | 'middle' | 'front'; position: Vec3 }[];
  cup: Vec3;
  greenCenter: Vec3;
  cameraHint?: Vec3;
}

export interface CourseFeatures {
  fairways: Spline[];
  greens: Polygon[];
  bunkers: Polygon[];
  water: Polygon[];
  outOfBounds: Polygon[];
  paths?: Spline[];
  trees: { position: Vec3; kind: string; scale: number; rotation: number }[];
}

export interface Spline {
  points: { x: number; z: number }[];
  widths: number[];
  surface: SurfaceId;
  edgeSurface?: SurfaceId;
  edgeWidth?: number;
}

export interface Polygon {
  points: { x: number; z: number }[];
  surface: SurfaceId;
}

export class Heightfield {
  readonly data: Float32Array;
  readonly width: number;
  readonly depth: number;
  readonly cellSize: number;
  readonly origin: { x: number; z: number };

  constructor(data: Float32Array, width: number, depth: number, cellSize: number, origin: { x: number; z: number }) {
    if (data.length !== width * depth) throw new Error('Heightfield data dimensions do not match');
    this.data = data;
    this.width = width;
    this.depth = depth;
    this.cellSize = cellSize;
    this.origin = origin;
  }

  heightAt(x: number, z: number): number {
    const gx = Math.max(0, Math.min(this.width - 1, (x - this.origin.x) / this.cellSize));
    const gz = Math.max(0, Math.min(this.depth - 1, (z - this.origin.z) / this.cellSize));
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const x1 = Math.min(this.width - 1, x0 + 1);
    const z1 = Math.min(this.depth - 1, z0 + 1);
    const tx = gx - x0;
    const tz = gz - z0;
    const h00 = this.data[z0 * this.width + x0] ?? 0;
    const h10 = this.data[z0 * this.width + x1] ?? h00;
    const h01 = this.data[z1 * this.width + x0] ?? h00;
    const h11 = this.data[z1 * this.width + x1] ?? h00;
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  normalAt(x: number, z: number): Vec3 {
    const d = this.cellSize;
    const dx = (this.heightAt(x + d, z) - this.heightAt(x - d, z)) / (2 * d);
    const dz = (this.heightAt(x, z + d) - this.heightAt(x, z - d)) / (2 * d);
    const length = Math.hypot(dx, 1, dz);
    return { x: -dx / length, y: 1 / length, z: -dz / length };
  }
}

export class SurfaceMask {
  readonly data: Uint8Array;
  readonly width: number;
  readonly depth: number;
  readonly cellSize: number;
  readonly origin: { x: number; z: number };

  constructor(data: Uint8Array, width: number, depth: number, cellSize: number, origin: { x: number; z: number }) {
    if (data.length !== width * depth) throw new Error('Surface mask data dimensions do not match');
    this.data = data;
    this.width = width;
    this.depth = depth;
    this.cellSize = cellSize;
    this.origin = origin;
  }

  surfaceAt(x: number, z: number): SurfaceId {
    const gx = Math.max(0, Math.min(this.width - 1, Math.round((x - this.origin.x) / this.cellSize)));
    const gz = Math.max(0, Math.min(this.depth - 1, Math.round((z - this.origin.z) / this.cellSize)));
    return (this.data[gz * this.width + gx] ?? SurfaceId.Rough) as SurfaceId;
  }
}

export function createTerrainSampler(hf: Heightfield, mask: SurfaceMask): TerrainSampler {
  return {
    heightAt: (x, z) => hf.heightAt(x, z),
    normalAt: (x, z) => hf.normalAt(x, z),
    surfaceAt: (x, z) => mask.surfaceAt(x, z),
  };
}

export interface LoadedCourse {
  manifest: CourseManifest;
  heightfield: Heightfield;
  surfaceMask: SurfaceMask;
  sampler: TerrainSampler;
  cupFor(hole: number | HoleDef): Cup;
}

export function parseCourse(manifest: CourseManifest, heightBuf: ArrayBuffer, maskBuf: ArrayBuffer): LoadedCourse {
  const heights = new Float32Array(heightBuf);
  const mask = new Uint8Array(maskBuf);
  const heightfield = new Heightfield(
    heights,
    manifest.heightfield.width,
    manifest.heightfield.depth,
    manifest.heightfield.cellSize,
    manifest.heightfield.origin,
  );
  const surfaceMask = new SurfaceMask(
    mask,
    manifest.surfaceMask.width,
    manifest.surfaceMask.depth,
    manifest.surfaceMask.cellSize,
    manifest.surfaceMask.origin,
  );
  const sampler = createTerrainSampler(heightfield, surfaceMask);
  return {
    manifest,
    heightfield,
    surfaceMask,
    sampler,
    cupFor: (hole: number | HoleDef): Cup => {
      const definition = typeof hole === 'number' ? manifest.holes.find((item) => item.number === hole) : hole;
      if (!definition) throw new Error(`Unknown hole: ${String(hole)}`);
      return {
        position: { x: definition.cup.x, y: heightfield.heightAt(definition.cup.x, definition.cup.z), z: definition.cup.z },
        radius: 0.054,
        depth: 0.1,
      };
    },
  };
}

export async function loadCourse(
  baseUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<LoadedCourse> {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const manifestResponse = await fetchFn(`${base}course.json`);
  if (!manifestResponse.ok) throw new Error(`Unable to load course manifest (${manifestResponse.status})`);
  const manifest = (await manifestResponse.json()) as CourseManifest;
  const [heightResponse, maskResponse] = await Promise.all([
    fetchFn(`${base}${manifest.heightfield.file}`),
    fetchFn(`${base}${manifest.surfaceMask.file}`),
  ]);
  if (!heightResponse.ok || !maskResponse.ok) throw new Error('Unable to load course binaries');
  return parseCourse(manifest, await heightResponse.arrayBuffer(), await maskResponse.arrayBuffer());
}
