import { BALL } from './physics.js';
import type { AeroConfig } from './types.js';

export function dragCoefficient(speed: number, spinRatio: number): number {
  const base = speed > 35 ? 0.205 : 0.22;
  return Math.min(0.4, base + 0.25 * Math.max(0, Math.min(1, spinRatio)));
}

export function liftCoefficient(speed: number, spinRatio: number): number {
  const reynoldsFactor = speed > 35 ? 1 : 0.9;
  return Math.min(0.27, Math.max(0, 0.1 + 0.8 * Math.max(0, Math.min(1, spinRatio)))) * reynoldsFactor;
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
