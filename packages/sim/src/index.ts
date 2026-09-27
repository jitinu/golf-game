export * from './types.js';
export * from './vec.js';
export * from './physics.js';
export * from './aero.js';
export * from './rng.js';
export * from './clubs.js';
export { stepBall, stepBallWithEvents, simulateShot } from './step.js';
import type { Vec3 } from './types.js';

export function holeDistance(from: Vec3, to: Vec3): number {
  return Math.hypot(to.x - from.x, to.z - from.z);
}

export function computeAimYaw(from: Vec3, to: Vec3): number {
  return Math.atan2(to.x - from.x, -(to.z - from.z));
}
