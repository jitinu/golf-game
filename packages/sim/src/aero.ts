import { BALL } from './physics.js';
import type { AeroConfig } from './types.js';

export function dragCoefficient(speed: number, spinRatio: number): number {
  const base = speed > 35 ? 0.19 : 0.21;
  return base + 0.09 * Math.max(0, Math.min(1, spinRatio));
}

export function liftCoefficient(speed: number, spinRatio: number): number {
  const reynoldsFactor = speed > 35 ? 1 : 0.9;
  return Math.min(0.35, Math.max(0, 0.15 + 1.6 * spinRatio)) * reynoldsFactor;
}

export const DEFAULT_AERO: AeroConfig = {
  airDensity: 1.225,
  dragMultiplier: 1,
  liftMultiplier: 1,
  spinDecayPerSecond: 0.07,
};

export function spinRatio(speed: number, angularSpeed: number): number {
  return speed > 0.01 ? (angularSpeed * BALL.radius) / speed : 0;
}
