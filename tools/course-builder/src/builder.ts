import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CourseFeatures, CourseManifest, Polygon, Spline } from '@golf/course-format';
import { SurfaceId } from '@golf/sim';

export interface SourceCourse extends Omit<CourseManifest, 'heightfield' | 'surfaceMask'> {
  terrain: {
    baseHeight: number;
    noise: { seed: number; amplitude: number; frequency: number; octaves: number };
    /** Fine undulation layered on the rolling base (defaults: 0.35 m at ~22 m wavelength). */
    detail?: { amplitude: number; frequency: number };
    /** Mid-scale rolling (defaults: 0.9 m at ~55 m wavelength) so fairways rise and fall along their length. */
    roll?: { amplitude: number; frequency: number };
    /** Fairways sit a little proud along their centreline and fall away to the edges (metres, default 0.3). */
    fairwayCrown?: number;
    mounds: { x: number; z: number; radius: number; height: number }[];
    greenFlatten?: boolean;
  };
  map: { width: number; depth: number };
  heightCellSize: number;
  maskCellSize: number;
  /** Deterministic tree belts along the holes, appended to the hand-placed `features.trees`. */
  treeScatter?: TreeScatter;
  /** Streams authored as centrelines; rasterised into `features.water` polygons with a fixed water level. */
  rivers?: River[];
}

export interface River {
  points: { x: number; z: number }[];
  widths: number[];
  /** Absolute water surface height; terrain is carved below it and banks blended down to meet it. */
  level: number;
}

/** Terrain carved out around hazards, in metres. */
const BUNKER_DEPTH = 0.55;
const BUNKER_LIP = 0.18;
const BUNKER_BLEND = 2.5;
const WATER_BANK = 0.35;
const WATER_BED = 1.4;
const WATER_BLEND = 7;
/** Tee complex: one mown strip through all of a hole's tee markers, with a first-cut collar around it. */
const TEE_STRIP_HALF_WIDTH_M = 5;
const TEE_STRIP_END_M = 5;
const TEE_COLLAR_M = 2.5;
/** Mown edges wander by this fraction of the local half width so fairways never have ruler-straight sides. */
const EDGE_WANDER = 0.16;
const EDGE_WANDER_FREQUENCY = 0.035;
const DETAIL_DEFAULT = { amplitude: 0.35, frequency: 0.045 };
const ROLL_DEFAULT = { amplitude: 0.9, frequency: 0.018 };
/** Greens sit this far above the mean surrounding terrain, blended back down over GREEN_PAD_BLEND metres. */
const GREEN_PAD_RISE = 0.55;
const GREEN_PAD_BLEND = 7;
/**
 * Every hole is graded like a real one: the tee complex sits up, the green is a raised target, and along the fairway
 * corridor the macro relief is blended toward that straight tee->green profile so the green stays in sight from the
 * tee. Only a share of the macro relief survives on the fairway; detail noise and the crown still undulate it.
 */
const GRADE_TEE_RISE = 1.2;
const GRADE_GREEN_RISE = 1.1;
const GRADE_KEEP = 0.35;
const GRADE_MARGIN_M = 8;
const GRADE_BLEND_M = 16;

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export interface TreeScatter {
  seed: number;
  /** Grid pitch of candidate positions in metres; each is jittered by up to half a cell. */
  spacing: number;
  /** Fraction of candidates kept (0–1). */
  density: number;
  /** Trees stand at least this far outside the fairway/first-cut edge and green polygons. */
  minPlayDistance: number;
  /** Candidates further than this from any hole are dropped so belts hug the holes. */
  maxPlayDistance: number;
  kinds: { kind: string; weight: number; scale: [number, number] }[];
  /** Species picked instead of `kinds` for candidates within `waterDistance` metres of a water body. */
  waterKinds?: { kind: string; weight: number; scale: [number, number] }[];
  waterDistance?: number;
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

const sampledSplines = new WeakMap<Spline, { x: number; z: number; width: number }[]>();

function sampledSpline(spline: Spline): { x: number; z: number; width: number }[] {
  let sampled = sampledSplines.get(spline);
  if (!sampled) {
    sampled = catmullRom(spline.points, spline.widths);
    sampledSplines.set(spline, sampled);
  }
  return sampled;
}

/** Distance to the centreline and the interpolated width at the closest point, so widths vary along the hole. */
function splineNearest(x: number, z: number, spline: Spline): { distance: number; width: number } {
  const sampled = sampledSpline(spline);
  let best = { distance: Number.POSITIVE_INFINITY, width: spline.widths[0] ?? 1 };
  for (let index = 1; index < sampled.length; index += 1) {
    const a = sampled[index - 1]!;
    const b = sampled[index]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const denominator = dx * dx + dz * dz;
    const t = denominator === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / denominator));
    const distance = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
    if (distance < best.distance) best = { distance, width: a.width + (b.width - a.width) * t };
  }
  return best;
}

/** Signed distance to the mown edge (negative inside), with the edge wandering so it never reads as ruler-straight. */
function splineEdgeDistance(x: number, z: number, spline: Spline, wander: SimplexNoise | undefined): number {
  const nearest = splineNearest(x, z, spline);
  const wobble = wander ? 1 + EDGE_WANDER * fbm(wander, x, z, EDGE_WANDER_FREQUENCY, 2) * 2 : 1;
  return nearest.distance - (nearest.width / 2) * wobble;
}

function classifySurface(x: number, z: number, features: CourseFeatures, wander?: SimplexNoise): SurfaceId {
  let surface = SurfaceId.Rough;
  for (const spline of features.fairways) {
    const edge = splineEdgeDistance(x, z, spline, wander);
    if (edge <= 0) surface = spline.surface;
    else if (spline.edgeSurface !== undefined) {
      // The intermediate cut breathes between roughly half and one-and-a-half times its nominal width.
      const collar = (spline.edgeWidth ?? 0) * (wander ? 1 + fbm(wander, x + 500, z - 500, EDGE_WANDER_FREQUENCY * 1.7, 2) * 0.6 : 1);
      if (edge <= collar) surface = spline.edgeSurface;
    }
  }
  for (const spline of features.paths ?? []) {
    if (splineNearest(x, z, spline).distance <= Math.max(...spline.widths, 1) / 2) surface = spline.surface;
  }
  for (const polygon of features.greens) if (pointInPolygon(x, z, polygon)) surface = polygon.surface;
  for (const polygon of features.bunkers) if (pointInPolygon(x, z, polygon)) surface = polygon.surface;
  for (const polygon of features.water) if (pointInPolygon(x, z, polygon)) surface = polygon.surface;
  for (const polygon of features.outOfBounds) if (pointInPolygon(x, z, polygon)) surface = polygon.surface;
  return surface;
}

/** Widens a centreline into a closed polygon: left offsets forward, right offsets back. */
function riverPolygon(river: River): Polygon {
  const sampled = catmullRom(river.points, river.widths, 12);
  const left: { x: number; z: number }[] = [];
  const right: { x: number; z: number }[] = [];
  for (let index = 0; index < sampled.length; index += 1) {
    const previous = sampled[Math.max(0, index - 1)]!;
    const next = sampled[Math.min(sampled.length - 1, index + 1)]!;
    const length = Math.hypot(next.x - previous.x, next.z - previous.z) || 1;
    const nx = -(next.z - previous.z) / length;
    const nz = (next.x - previous.x) / length;
    const half = sampled[index]!.width / 2;
    left.push({ x: sampled[index]!.x + nx * half, z: sampled[index]!.z + nz * half });
    right.push({ x: sampled[index]!.x - nx * half, z: sampled[index]!.z - nz * half });
  }
  return { points: [...left, ...right.reverse()], surface: SurfaceId.Water, waterLevel: river.level };
}

/** Distance to the polygon outline, negative inside. */
function polygonSignedDistance(x: number, z: number, polygon: Polygon): number {
  let distance = Number.POSITIVE_INFINITY;
  const points = polygon.points;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) distance = Math.min(distance, distanceToSegment(x, z, points[j]!, points[i]!));
  return pointInPolygon(x, z, polygon) ? -distance : distance;
}

/** Large-scale relief only: base level, macro noise, rolling swells and authored mounds. */
function macroHeightAt(source: SourceCourse, noise: SimplexNoise, x: number, z: number): number {
  const terrain = source.terrain;
  const roll = terrain.roll ?? ROLL_DEFAULT;
  let height = terrain.baseHeight + terrain.noise.amplitude * fbm(noise, x, z, terrain.noise.frequency, terrain.noise.octaves);
  height += roll.amplitude * fbm(noise, x - 2000, z + 2000, roll.frequency, 2);
  for (const mound of terrain.mounds) {
    const distance = Math.hypot(x - mound.x, z - mound.z);
    if (distance < mound.radius) height += mound.height * (1 - distance / mound.radius) ** 2;
  }
  return height;
}

interface HoleGrade {
  tee: { x: number; z: number };
  cup: { x: number; z: number };
  teeHeight: number;
  cupHeight: number;
  fairway: Spline | undefined;
}

const holeGrades = new WeakMap<SourceCourse, HoleGrade[]>();

function gradesOf(source: SourceCourse, noise: SimplexNoise): HoleGrade[] {
  let grades = holeGrades.get(source);
  if (grades) return grades;
  grades = [];
  for (const hole of source.holes) {
    const back = hole.tees[0]?.position;
    if (!back) continue;
    const tee = { x: back.x, z: back.z };
    const cup = { x: hole.cup.x, z: hole.cup.z };
    let fairway: Spline | undefined;
    let nearest = Number.POSITIVE_INFINITY;
    for (const spline of source.features.fairways) {
      const first = spline.points[0];
      if (!first) continue;
      const distance = Math.hypot(first.x - tee.x, first.z - tee.z);
      if (distance < nearest) {
        nearest = distance;
        fairway = spline;
      }
    }
    grades.push({
      tee,
      cup,
      teeHeight: macroHeightAt(source, noise, tee.x, tee.z) + GRADE_TEE_RISE,
      cupHeight: macroHeightAt(source, noise, cup.x, cup.z) + GRADE_GREEN_RISE,
      fairway,
    });
  }
  holeGrades.set(source, grades);
  return grades;
}

function gradedMacroHeightAt(source: SourceCourse, noise: SimplexNoise, x: number, z: number): number {
  let height = macroHeightAt(source, noise, x, z);
  for (const grade of gradesOf(source, noise)) {
    const dx = grade.cup.x - grade.tee.x;
    const dz = grade.cup.z - grade.tee.z;
    const length2 = dx * dx + dz * dz;
    const along = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - grade.tee.x) * dx + (z - grade.tee.z) * dz) / length2));
    let distance = distanceToSegment(x, z, grade.tee, grade.cup);
    let half = TEE_STRIP_HALF_WIDTH_M;
    if (grade.fairway) {
      const nearest = splineNearest(x, z, grade.fairway);
      const fairwayHalf = nearest.width / 2 + (grade.fairway.edgeWidth ?? 0);
      if (nearest.distance - fairwayHalf < distance - half) {
        distance = nearest.distance;
        half = fairwayHalf;
      }
    }
    const weight = (1 - smoothstep(half + GRADE_MARGIN_M, half + GRADE_MARGIN_M + GRADE_BLEND_M, distance)) * (1 - GRADE_KEEP);
    if (weight <= 0) continue;
    const target = grade.teeHeight + (grade.cupHeight - grade.teeHeight) * along;
    height += (target - height) * weight;
  }
  return height;
}

function baseHeightAt(source: SourceCourse, noise: SimplexNoise, x: number, z: number): number {
  const terrain = source.terrain;
  const detail = terrain.detail ?? DETAIL_DEFAULT;
  let height = gradedMacroHeightAt(source, noise, x, z);
  height += detail.amplitude * fbm(noise, x + 1000, z - 1000, detail.frequency, 3);
  for (const spline of source.features.fairways) {
    const nearest = splineNearest(x, z, spline);
    const half = nearest.width / 2 + (spline.edgeWidth ?? 0) + 4;
    if (nearest.distance < half) height += (terrain.fairwayCrown ?? 0.3) * (1 - (nearest.distance / half) ** 2);
  }
  return height;
}

/** Water polygons without an authored level sit just below the mean terrain along their outline. */
function waterLevelOf(source: SourceCourse, noise: SimplexNoise, polygon: Polygon): number {
  if (polygon.waterLevel !== undefined) return polygon.waterLevel;
  const mean = polygon.points.reduce((sum, point) => sum + baseHeightAt(source, noise, point.x, point.z), 0) / Math.max(1, polygon.points.length);
  return mean - WATER_BANK;
}

/**
 * Final terrain height: rolling base terrain, bunkers dished below a raised lip, and water bodies carved to a flat
 * bed with banks that blend the surrounding ground down to the water level.
 */
function heightAt(source: SourceCourse, noise: SimplexNoise, water: { polygon: Polygon; level: number }[], x: number, z: number): number {
  let height = baseHeightAt(source, noise, x, z);
  for (const polygon of source.features.bunkers) {
    const distance = polygonSignedDistance(x, z, polygon);
    if (distance < 0) height -= BUNKER_DEPTH * smoothstep(0, BUNKER_BLEND, -distance);
    else if (distance < BUNKER_BLEND) height += BUNKER_LIP * (1 - smoothstep(0, BUNKER_BLEND, distance)) * smoothstep(-0.5, 0.8, distance);
  }
  for (const { polygon, level } of water) {
    const distance = polygonSignedDistance(x, z, polygon);
    if (distance >= WATER_BLEND) continue;
    if (distance >= 0) {
      height = (level + WATER_BANK) * (1 - smoothstep(0, WATER_BLEND, distance)) + height * smoothstep(0, WATER_BLEND, distance);
    } else {
      const bank = level + WATER_BANK;
      const bed = level - WATER_BED;
      height = bank + (bed - bank) * smoothstep(0, 4, -distance);
    }
  }
  return height;
}

function hash2(seed: number, x: number, z: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(x + 0x1000, 0xc2b2ae35) ^ Math.imul(z + 0x2000, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1] on a `scale`-metre lattice; used for grove/clearing structure in the tree belts. */
function groveNoise(seed: number, x: number, z: number, scale: number): number {
  const u = x / scale;
  const v = z / scale;
  const x0 = Math.floor(u);
  const z0 = Math.floor(v);
  const fx = u - x0;
  const fz = v - z0;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(seed, x0, z0);
  const b = hash2(seed, x0 + 1, z0);
  const c = hash2(seed, x0, z0 + 1);
  const d = hash2(seed, x0 + 1, z0 + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

function polygonDistance(x: number, z: number, polygon: Polygon): number {
  if (pointInPolygon(x, z, polygon)) return 0;
  let distance = Number.POSITIVE_INFINITY;
  const points = polygon.points;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) distance = Math.min(distance, distanceToSegment(x, z, points[j]!, points[i]!));
  return distance;
}

/** Distance to the centreline of the nearest hole's tee strip (back tee to front tee, extended a little each way). */
function teeStripDistance(x: number, z: number, source: SourceCourse): number {
  let distance = Number.POSITIVE_INFINITY;
  for (const hole of source.holes) {
    const tees = hole.tees.map((tee) => tee.position);
    if (tees.length === 0) continue;
    const back = tees[0]!;
    const front = tees[tees.length - 1]!;
    const length = Math.hypot(front.x - back.x, front.z - back.z);
    const dirX = length > 0 ? (front.x - back.x) / length : 0;
    const dirZ = length > 0 ? (front.z - back.z) / length : 1;
    const a = { x: back.x - dirX * TEE_STRIP_END_M, z: back.z - dirZ * TEE_STRIP_END_M };
    const b = { x: front.x + dirX * TEE_STRIP_END_M, z: front.z + dirZ * TEE_STRIP_END_M };
    distance = Math.min(distance, distanceToSegment(x, z, a, b));
  }
  return distance;
}

/** Distance from the nearest in-play area (fairway incl. first cut, greens, tees). */
function playDistance(x: number, z: number, source: SourceCourse): number {
  let distance = Number.POSITIVE_INFINITY;
  for (const spline of source.features.fairways) {
    distance = Math.min(distance, splineEdgeDistance(x, z, spline, undefined) - (spline.edgeWidth ?? 0));
  }
  for (const spline of source.features.paths ?? []) {
    distance = Math.min(distance, splineNearest(x, z, spline).distance - Math.max(...spline.widths, 1) / 2);
  }
  for (const polygon of [...source.features.greens, ...source.features.bunkers]) distance = Math.min(distance, polygonDistance(x, z, polygon));
  distance = Math.min(distance, teeStripDistance(x, z, source) - TEE_STRIP_HALF_WIDTH_M - TEE_COLLAR_M);
  return distance;
}

function pickKind(kinds: TreeScatter['kinds'], roll: number): TreeScatter['kinds'][number] {
  let pick = roll * kinds.reduce((sum, kind) => sum + kind.weight, 0);
  return kinds.find((candidate) => (pick -= candidate.weight) <= 0) ?? kinds[kinds.length - 1]!;
}

export function scatterTrees(source: SourceCourse): CourseFeatures['trees'] {
  const scatter = source.treeScatter;
  if (!scatter || scatter.kinds.length === 0) return [];
  const waterKinds = scatter.waterKinds ?? [];
  const waterDistance = scatter.waterDistance ?? 12;
  const trees: CourseFeatures['trees'] = [];
  const minSpacing = scatter.spacing * 0.7;
  const accepted = new Map<string, { x: number; z: number }[]>();
  const canPlace = (x: number, z: number): boolean => {
    const cellX = Math.floor(x / minSpacing);
    const cellZ = Math.floor(z / minSpacing);
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const neighbours = accepted.get(`${cellX + dx}:${cellZ + dz}`) ?? [];
        if (neighbours.some((point) => Math.hypot(point.x - x, point.z - z) < minSpacing)) return false;
      }
    }
    const key = `${cellX}:${cellZ}`;
    const points = accepted.get(key) ?? [];
    points.push({ x, z });
    accepted.set(key, points);
    return true;
  };
  const columns = Math.floor(source.map.width / scatter.spacing);
  const rows = Math.floor(source.map.depth / scatter.spacing);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      // Jitter well beyond the cell so the grid never shows, and modulate density with two noise octaves so
      // the belts form dense groves and open clearings instead of an even carpet.
      const x = (column + 0.5 + (hash2(scatter.seed + 1, column, row) - 0.5) * 1.6) * scatter.spacing;
      const z = (row + 0.5 + (hash2(scatter.seed + 2, column, row) - 0.5) * 1.6) * scatter.spacing;
      const grove = groveNoise(scatter.seed + 11, x, z, 70) * 0.65 + groveNoise(scatter.seed + 12, x, z, 24) * 0.35;
      const localDensity = scatter.density * Math.min(1.5, Math.max(0, grove * 2.2 - 0.25));
      if (hash2(scatter.seed, column, row) > localDensity) continue;
      if (x < 6 || z < 6 || x > source.map.width - 6 || z > source.map.depth - 6) continue;
      const surface = classifySurface(x, z, source.features);
      if (surface !== SurfaceId.Rough && surface !== SurfaceId.OutOfBounds) continue;
      const distance = playDistance(x, z, source);
      if (distance < scatter.minPlayDistance || distance > scatter.maxPlayDistance) continue;
      const nearWater = waterKinds.length > 0 && source.features.water.some((polygon) => polygonDistance(x, z, polygon) < waterDistance);
      const kind = pickKind(nearWater ? waterKinds : scatter.kinds, hash2(scatter.seed + 3, column, row));
      if (!canPlace(x, z)) continue;
      // Skew toward mid-size with occasional giants so the canopy line breaks up. Grove noise biases
      // neighbouring candidates toward the same scale, creating coherent canopy groups.
      const t = hash2(scatter.seed + 4, column, row);
      const local = t < 0.85 ? t / 0.85 * 0.8 : 0.8 + ((t - 0.85) / 0.15) * 0.2;
      const baseScale = kind.scale[0] + (kind.scale[1] - kind.scale[0]) * local;
      const groveBias = 0.86 + grove * 0.28;
      const scale = Math.min(1.4, Math.max(0.72, baseScale * groveBias));
      const stretch = 0.9 + hash2(scatter.seed + 6, column, row) * 0.3;
      trees.push({
        position: { x, y: 0, z },
        kind: kind.kind,
        scale: Math.round(scale * 100) / 100,
        stretch: Math.round(stretch * 100) / 100,
        rotation: Math.round(hash2(scatter.seed + 5, column, row) * Math.PI * 2 * 100) / 100,
      });
    }
  }
  return trees;
}

export function buildCourse(source: SourceCourse): { manifest: CourseManifest; height: Float32Array; surface: Uint8Array } {
  const width = Math.round(source.map.width / source.heightCellSize) + 1;
  const depth = Math.round(source.map.depth / source.heightCellSize) + 1;
  const maskWidth = Math.round(source.map.width / source.maskCellSize) + 1;
  const maskDepth = Math.round(source.map.depth / source.maskCellSize) + 1;
  const noise = new SimplexNoise(source.terrain.noise.seed);
  const waterPolygons = [...source.features.water, ...(source.rivers ?? []).map(riverPolygon)];
  const features: CourseFeatures = { ...source.features, water: waterPolygons };
  const water = waterPolygons.map((polygon) => ({ polygon, level: waterLevelOf(source, noise, polygon) }));
  const height = new Float32Array(width * depth);
  for (let iz = 0; iz < depth; iz += 1) {
    for (let ix = 0; ix < width; ix += 1) {
      height[iz * width + ix] = heightAt(source, noise, water, ix * source.heightCellSize, iz * source.heightCellSize);
    }
  }
  if (source.terrain.greenFlatten) {
    const hazards = [...source.features.bunkers, ...waterPolygons];
    for (const green of source.features.greens) {
      const target = green.points.reduce(
        (sum, point) => sum + heightAt(source, noise, water, point.x, point.z),
        0,
      ) / Math.max(1, green.points.length);
      // Push-up green: the putting surface sits a little proud on a levelled pad whose surrounds blend back
      // into the rolling terrain over a few metres instead of stepping off at the polygon edge.
      const pad = target + GREEN_PAD_RISE;
      for (let iz = 0; iz < depth; iz += 1) {
        for (let ix = 0; ix < width; ix += 1) {
          const x = ix * source.heightCellSize;
          const z = iz * source.heightCellSize;
          const signed = polygonSignedDistance(x, z, green);
          if (signed > GREEN_PAD_BLEND) continue;
          if (signed > 0 && hazards.some((hazard) => pointInPolygon(x, z, hazard))) continue;
          const blend = signed <= 0 ? 1 : 1 - smoothstep(0, GREEN_PAD_BLEND, signed);
          const index = iz * width + ix;
          height[index] = height[index]! + (pad - height[index]!) * blend;
        }
      }
    }
  }
  let minHeight = Number.POSITIVE_INFINITY;
  let maxHeight = Number.NEGATIVE_INFINITY;
  for (const value of height) {
    minHeight = Math.min(minHeight, value);
    maxHeight = Math.max(maxHeight, value);
  }
  const surface = new Uint8Array(maskWidth * maskDepth);
  for (let iz = 0; iz < maskDepth; iz += 1) {
    for (let ix = 0; ix < maskWidth; ix += 1) {
      const x = ix * source.maskCellSize;
      const z = iz * source.maskCellSize;
      let id = classifySurface(x, z, features, noise);
      // Tee complexes are mown to fairway height with a first-cut collar (only ever carved out of rough / first cut).
      if (id === SurfaceId.Rough || id === SurfaceId.FirstCut) {
        const tee = teeStripDistance(x, z, source);
        if (tee <= TEE_STRIP_HALF_WIDTH_M) id = SurfaceId.Fairway;
        else if (tee <= TEE_STRIP_HALF_WIDTH_M + TEE_COLLAR_M) id = SurfaceId.FirstCut;
      }
      surface[iz * maskWidth + ix] = id;
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
    features: {
      ...features,
      water: water.map(({ polygon, level }) => ({ ...polygon, waterLevel: Math.round(level * 1000) / 1000 })),
      trees: [...source.features.trees, ...scatterTrees({ ...source, features })],
    },
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
