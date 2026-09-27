import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CourseFeatures, CourseManifest, Polygon, Spline } from '@golf/course-format';
import { SurfaceId } from '@golf/sim';

export interface SourceCourse extends Omit<CourseManifest, 'heightfield' | 'surfaceMask'> {
  terrain: {
    baseHeight: number;
    noise: { seed: number; amplitude: number; frequency: number; octaves: number };
    mounds: { x: number; z: number; radius: number; height: number }[];
    greenFlatten?: boolean;
  };
  map: { width: number; depth: number };
  heightCellSize: number;
  maskCellSize: number;
}

class SimplexNoise {
  private readonly permutation: number[];

  constructor(seed: number) {
    const values = Array.from({ length: 256 }, (_, index) => index);
    let state = seed >>> 0;
    for (let index = values.length - 1; index > 0; index -= 1) {
      state = Math.imul(state ^ (state >>> 16), 2246822519) >>> 0;
      const swap = state % (index + 1);
      [values[index], values[swap]] = [values[swap]!, values[index]!];
    }
    this.permutation = [...values, ...values];
  }

  sample(x: number, y: number): number {
    const floorX = Math.floor(x);
    const floorY = Math.floor(y);
    const xf = x - floorX;
    const yf = y - floorY;
    const fade = (value: number) => value * value * (3 - 2 * value);
    const grad = (hash: number, dx: number, dy: number) => {
      const h = hash & 3;
      const u = h < 2 ? dx : dy;
      const v = h < 2 ? dy : dx;
      return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    };
    const ix = floorX & 255;
    const iy = floorY & 255;
    const p = this.permutation;
    const aa = p[p[ix]! + iy]!;
    const ab = p[p[ix]! + iy + 1]!;
    const ba = p[p[ix + 1]! + iy]!;
    const bb = p[p[ix + 1]! + iy + 1]!;
    const u = fade(xf);
    const v = fade(yf);
    const x0 = grad(aa, xf, yf);
    const x1 = grad(ba, xf - 1, yf);
    const x2 = grad(ab, xf, yf - 1);
    const x3 = grad(bb, xf - 1, yf - 1);
    return (x0 + (x1 - x0) * u + (x2 + (x3 - x2) * u - x0 - (x1 - x0) * u) * v) * 0.707;
  }
}

export function fbm(noise: SimplexNoise, x: number, z: number, frequency: number, octaves: number): number {
  let amplitude = 1;
  let sum = 0;
  let normalization = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += noise.sample(x * frequency, z * frequency) * amplitude;
    normalization += amplitude;
    frequency *= 2;
    amplitude *= 0.5;
  }
  return sum / normalization;
}

function pointInPolygon(x: number, z: number, polygon: Polygon): boolean {
  let inside = false;
  const points = polygon.points;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const current = points[i]!;
    const previous = points[j]!;
    const intersects = (current.z > z) !== (previous.z > z) &&
      x < ((previous.x - current.x) * (z - current.z)) / (previous.z - current.z) + current.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function distanceToSegment(x: number, z: number, a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const denominator = dx * dx + dz * dz;
  const t = denominator === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / denominator));
  return Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
}

function catmullRom(points: { x: number; z: number }[], widths: number[], count = 20): { x: number; z: number; width: number }[] {
  if (points.length < 2) return points.map((point, index) => ({ ...point, width: widths[index] ?? widths[0] ?? 1 }));
  const result: { x: number; z: number; width: number }[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)]!;
    const p1 = points[index]!;
    const p2 = points[index + 1]!;
    const p3 = points[Math.min(points.length - 1, index + 2)]!;
    for (let step = 0; step < count; step += 1) {
      const t = step / count;
      const t2 = t * t;
      const t3 = t2 * t;
      const blend = (a: number, b: number, c: number, d: number) =>
        0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      result.push({
        x: blend(p0.x, p1.x, p2.x, p3.x),
        z: blend(p0.z, p1.z, p2.z, p3.z),
        width: (widths[index] ?? widths[0] ?? 30) * (1 - t) + (widths[index + 1] ?? widths[index] ?? 30) * t,
      });
    }
  }
  const last = points[points.length - 1]!;
  result.push({ ...last, width: widths[widths.length - 1] ?? widths[0] ?? 30 });
  return result;
}

function splineDistance(x: number, z: number, spline: Spline): number {
  const sampled = catmullRom(spline.points, spline.widths);
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < sampled.length; index += 1) {
    distance = Math.min(distance, distanceToSegment(x, z, sampled[index - 1]!, sampled[index]!));
  }
  return distance;
}

function classifySurface(x: number, z: number, features: CourseFeatures): SurfaceId {
  let surface = SurfaceId.Rough;
  for (const spline of features.fairways) {
    const distance = splineDistance(x, z, spline);
    const width = Math.max(...spline.widths, 1) / 2;
    if (distance <= width) surface = spline.surface;
    else if (spline.edgeSurface !== undefined && distance <= width + (spline.edgeWidth ?? 0)) surface = spline.edgeSurface;
  }
  for (const spline of features.paths ?? []) {
    if (splineDistance(x, z, spline) <= Math.max(...spline.widths, 1) / 2) surface = spline.surface;
  }
  for (const polygon of features.greens) if (pointInPolygon(x, z, polygon)) surface = polygon.surface;
  for (const polygon of features.bunkers) if (pointInPolygon(x, z, polygon)) surface = polygon.surface;
  for (const polygon of features.water) if (pointInPolygon(x, z, polygon)) surface = polygon.surface;
  for (const polygon of features.outOfBounds) if (pointInPolygon(x, z, polygon)) surface = polygon.surface;
  return surface;
}

function heightAt(source: SourceCourse, noise: SimplexNoise, x: number, z: number): number {
  const terrain = source.terrain;
  let height = terrain.baseHeight + terrain.noise.amplitude * fbm(noise, x, z, terrain.noise.frequency, terrain.noise.octaves);
  for (const mound of terrain.mounds) {
    const distance = Math.hypot(x - mound.x, z - mound.z);
    if (distance < mound.radius) height += mound.height * (1 - distance / mound.radius) ** 2;
  }
  for (const polygon of source.features.bunkers) {
    if (pointInPolygon(x, z, polygon)) height -= 0.4;
  }
  for (const polygon of source.features.water) {
    if (pointInPolygon(x, z, polygon)) height -= 1;
  }
  return height;
}

export function buildCourse(source: SourceCourse): { manifest: CourseManifest; height: Float32Array; surface: Uint8Array } {
  const width = Math.round(source.map.width / source.heightCellSize) + 1;
  const depth = Math.round(source.map.depth / source.heightCellSize) + 1;
  const maskWidth = Math.round(source.map.width / source.maskCellSize) + 1;
  const maskDepth = Math.round(source.map.depth / source.maskCellSize) + 1;
  const noise = new SimplexNoise(source.terrain.noise.seed);
  const height = new Float32Array(width * depth);
  let minHeight = Number.POSITIVE_INFINITY;
  let maxHeight = Number.NEGATIVE_INFINITY;
  for (let iz = 0; iz < depth; iz += 1) {
    for (let ix = 0; ix < width; ix += 1) {
      const value = heightAt(source, noise, ix * source.heightCellSize, iz * source.heightCellSize);
      height[iz * width + ix] = value;
      minHeight = Math.min(minHeight, value);
      maxHeight = Math.max(maxHeight, value);
    }
  }
  if (source.terrain.greenFlatten) {
    for (const green of source.features.greens) {
      const target = green.points.reduce(
        (sum, point) => sum + heightAt(source, noise, point.x, point.z),
        0,
      ) / Math.max(1, green.points.length);
      for (let iz = 0; iz < depth; iz += 1) {
        for (let ix = 0; ix < width; ix += 1) {
          if (pointInPolygon(ix * source.heightCellSize, iz * source.heightCellSize, green)) {
            height[iz * width + ix] = target;
          }
        }
      }
    }
  }
  const surface = new Uint8Array(maskWidth * maskDepth);
  for (let iz = 0; iz < maskDepth; iz += 1) {
    for (let ix = 0; ix < maskWidth; ix += 1) {
      surface[iz * maskWidth + ix] = classifySurface(ix * source.maskCellSize, iz * source.maskCellSize, source.features);
    }
  }
  const manifest: CourseManifest = {
    courseId: source.courseId,
    courseVersion: source.courseVersion,
    physicsVersion: source.physicsVersion,
    name: source.name,
    ...(source.description ? { description: source.description } : {}),
    heightfield: {
      width,
      depth,
      cellSize: source.heightCellSize,
      origin: { x: 0, z: 0 },
      minHeight,
      maxHeight,
      file: 'terrain.height.f32',
    },
    surfaceMask: {
      file: 'surface.u8',
      width: maskWidth,
      depth: maskDepth,
      cellSize: source.maskCellSize,
      origin: { x: 0, z: 0 },
    },
    holes: source.holes,
    features: source.features,
    ...(source.environment ? { environment: source.environment } : {}),
  };
  return { manifest, height, surface };
}

export async function buildCourseDirectory(sourcePath: string, outputDirectory: string): Promise<CourseManifest> {
  const source = JSON.parse(await readFile(sourcePath, 'utf8')) as SourceCourse;
  const built = buildCourse(source);
  await mkdir(outputDirectory, { recursive: true });
  const heightBytes = new Uint8Array(built.height.buffer);
  const surfaceBytes = built.surface;
  const hashes = {
    terrain: createHash('sha256').update(heightBytes).digest('hex'),
    surface: createHash('sha256').update(surfaceBytes).digest('hex'),
  };
  await writeFile(join(outputDirectory, 'terrain.height.f32'), heightBytes);
  await writeFile(join(outputDirectory, 'surface.u8'), surfaceBytes);
  await writeFile(join(outputDirectory, 'course.json'), `${JSON.stringify({ ...built.manifest, hashes }, null, 2)}\n`);
  return built.manifest;
}

export { dirname };
