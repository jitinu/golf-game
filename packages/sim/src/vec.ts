import type { Vec3 } from './types.js';

export const vec = {
  add: (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  sub: (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  scale: (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s }),
  dot: (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z,
  cross: (a: Vec3, b: Vec3): Vec3 => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }),
  length: (a: Vec3): number => Math.hypot(a.x, a.y, a.z),
  normalize: (a: Vec3): Vec3 => {
    const length = Math.hypot(a.x, a.y, a.z);
    return length > 1e-12 ? { x: a.x / length, y: a.y / length, z: a.z / length } : { x: 0, y: 0, z: 0 };
  },
  lerp: (a: Vec3, b: Vec3, t: number): Vec3 => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  }),
  zero: (): Vec3 => ({ x: 0, y: 0, z: 0 }),
  clone: (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z }),
};
