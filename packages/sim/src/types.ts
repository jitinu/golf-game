export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type BallMode = 'flight' | 'bounce' | 'roll' | 'rest' | 'holed';

export enum SurfaceId {
  Green = 0,
  Fairway = 1,
  FirstCut = 2,
  Rough = 3,
  Bunker = 4,
  Water = 5,
  Dirt = 6,
  Path = 7,
  OutOfBounds = 8,
}

export interface BallState {
  position: Vec3;
  velocity: Vec3;
  angularVelocity: Vec3;
  mode: BallMode;
  surface: SurfaceId;
  time: number;
}

export interface TerrainSampler {
  heightAt(x: number, z: number): number;
  normalAt(x: number, z: number): Vec3;
  surfaceAt(x: number, z: number): SurfaceId;
}

export interface Cup {
  position: Vec3;
  radius: number;
  depth: number;
}

export interface SurfacePhysics {
  restitution: number;
  friction: number;
  rollingResistance: number;
  spinRetention: number;
  minBounceSpeed: number;
  rollSpinFriction: number;
}

export interface AeroConfig {
  airDensity: number;
  dragMultiplier: number;
  liftMultiplier: number;
  spinDecayPerSecond: number;
}

export interface SimWorld {
  terrain: TerrainSampler;
  cup: Cup;
  aero: AeroConfig;
  surfaces?: Partial<Record<SurfaceId, SurfacePhysics>>;
  wind?: Vec3;
}

export type ShotEvent = {
  t: number;
  type: 'land' | 'bounce' | 'roll' | 'rest' | 'holed' | 'lipout' | 'water' | 'oob';
  position: Vec3;
  surface: SurfaceId;
};

export interface ShotResult {
  final: BallState;
  trajectory: BallState[];
  carryDistance: number;
  apexHeight: number;
  totalDistance: number;
  flightTime: number;
  holed: boolean;
  events: ShotEvent[];
}
