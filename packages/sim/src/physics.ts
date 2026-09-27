import { SurfaceId, type SurfacePhysics } from './types.js';

export const FIXED_DT = 1 / 120;
export const BALL = {
  mass: 0.04593,
  radius: 0.02135,
  area: Math.PI * 0.02135 * 0.02135,
};
export const GRAVITY = 9.81;

export const SURFACE_PHYSICS: Record<SurfaceId, SurfacePhysics> = {
  [SurfaceId.Green]: { restitution: 0.35, friction: 0.22, rollingResistance: 0.9, spinRetention: 0.8, minBounceSpeed: 1.2, rollSpinFriction: 0.35 },
  [SurfaceId.Fairway]: { restitution: 0.48, friction: 0.3, rollingResistance: 2, spinRetention: 0.72, minBounceSpeed: 1.6, rollSpinFriction: 0.5 },
  [SurfaceId.FirstCut]: { restitution: 0.4, friction: 0.4, rollingResistance: 3, spinRetention: 0.62, minBounceSpeed: 1.5, rollSpinFriction: 0.65 },
  [SurfaceId.Rough]: { restitution: 0.32, friction: 0.55, rollingResistance: 5, spinRetention: 0.5, minBounceSpeed: 1.4, rollSpinFriction: 0.8 },
  [SurfaceId.Bunker]: { restitution: 0.15, friction: 0.8, rollingResistance: 6, spinRetention: 0.3, minBounceSpeed: 1.1, rollSpinFriction: 0.9 },
  [SurfaceId.Water]: { restitution: 0, friction: 1, rollingResistance: 10, spinRetention: 0, minBounceSpeed: 100, rollSpinFriction: 1 },
  [SurfaceId.Dirt]: { restitution: 0.3, friction: 0.5, rollingResistance: 4, spinRetention: 0.55, minBounceSpeed: 1.4, rollSpinFriction: 0.7 },
  [SurfaceId.Path]: { restitution: 0.7, friction: 0.12, rollingResistance: 1.2, spinRetention: 0.9, minBounceSpeed: 1.4, rollSpinFriction: 0.25 },
  [SurfaceId.OutOfBounds]: { restitution: 0, friction: 1, rollingResistance: 10, spinRetention: 0, minBounceSpeed: 100, rollSpinFriction: 1 },
};
