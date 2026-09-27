import { BALL } from './physics.js';
import type { AeroConfig } from './types.js';

export function dragCoefficient(speed: number, spinRatio: number): number {
  const base = speed > 60 ? 0.2 : speed > 45 ? 0.25 : speed > 35 ? 0.3 : 0.3;
  return Math.min(0.3, base + 0.15 * Math.max(0, Math.min(1, spinRatio)));
}

export function liftCoefficient(speed: number, spinRatio: number): number {
  const reynoldsFactor = spinRatio > 0.5 ? 0.65 : 1;
  return Math.min(0.3, Math.max(0, 0.1 + 0.8 * Math.max(0, Math.min(1, spinRatio)))) * reynoldsFactor;
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
