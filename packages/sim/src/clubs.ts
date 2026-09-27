import driver from './clubs/driver.json';
import threeWood from './clubs/3-wood.json';
import fiveWood from './clubs/5-wood.json';
import fourHybrid from './clubs/4-hybrid.json';
import fourIron from './clubs/4-iron.json';
import fiveIron from './clubs/5-iron.json';
import sixIron from './clubs/6-iron.json';
import sevenIron from './clubs/7-iron.json';
import eightIron from './clubs/8-iron.json';
import nineIron from './clubs/9-iron.json';
import pitchingWedge from './clubs/pitching-wedge.json';
import gapWedge from './clubs/gap-wedge.json';
import sandWedge from './clubs/sand-wedge.json';
import lobWedge from './clubs/lob-wedge.json';
import putter from './clubs/putter.json';
import { SurfaceId, type BallState, type Vec3 } from './types.js';
import type { Rng } from './rng.js';

export interface ClubDef {
  id: string;
  displayName: string;
  category: 'driver' | 'wood' | 'hybrid' | 'iron' | 'wedge' | 'putter';
  loftDeg: number;
  launchAngleDeg: number;
  speedCurve: [number, number][];
  baseBackspinRpm: number;
  spinPerLaunchDeg?: number;
  accuracyToSideSpinRpm: number;
  accuracyToYawDeg: number;
  dispersionDeg: number;
  smashFactor?: number;
  maxCarryHintM: number;
}

export const CLUBS: Record<string, ClubDef> = {
  driver: driver as ClubDef,
  '3-wood': threeWood as ClubDef,
  '5-wood': fiveWood as ClubDef,
  '4-hybrid': fourHybrid as ClubDef,
  '4-iron': fourIron as ClubDef,
  '5-iron': fiveIron as ClubDef,
  '6-iron': sixIron as ClubDef,
  '7-iron': sevenIron as ClubDef,
  '8-iron': eightIron as ClubDef,
  '9-iron': nineIron as ClubDef,
  'pitching-wedge': pitchingWedge as ClubDef,
  'gap-wedge': gapWedge as ClubDef,
  'sand-wedge': sandWedge as ClubDef,
  'lob-wedge': lobWedge as ClubDef,
  putter: putter as ClubDef,
};

export const getClub = (id: string): ClubDef => {
  const club = CLUBS[id];
  if (!club) throw new Error(`Unknown club: ${id}`);
  return club;
};

export interface ShotCommand {
  clubId: string;
  aimYaw: number;
  power: number;
  accuracy: number;
  seed?: number;
}

export function shotToInitialState(
  cmd: ShotCommand,
  club: ClubDef,
  origin: Vec3,
  terrainSurface: SurfaceId,
  rng: Rng,
): BallState {
  const power = Math.max(0, Math.min(1, cmd.power));
  const accuracy = Math.max(-1, Math.min(1, cmd.accuracy));
  const randomYaw = (rng.next() * 2 - 1) * club.dispersionDeg * Math.PI / 180;
  const yaw = cmd.aimYaw + accuracy * club.accuracyToYawDeg * Math.PI / 180 + randomYaw;
  const speed = curveValue(club.speedCurve, power) * (terrainSurface === SurfaceId.Bunker ? 0.85 : terrainSurface === SurfaceId.Rough ? 0.93 : 1);
  const launch = club.launchAngleDeg * Math.PI / 180;
  const horizontal = speed * Math.cos(launch);
  const velocity = { x: horizontal * Math.sin(yaw), y: speed * Math.sin(launch), z: -horizontal * Math.cos(yaw) };
  const sideSpin = accuracy * club.accuracyToSideSpinRpm * Math.PI / 30;
  const backspin = club.baseBackspinRpm * Math.PI / 30;
  const axis = { x: Math.cos(yaw), y: 0, z: Math.sin(yaw) };
  const angularVelocity = { x: axis.x * (backspin + sideSpin), y: sideSpin * 0.05, z: axis.z * (backspin + sideSpin) };
  return {
    position: { ...origin },
    velocity,
    angularVelocity,
    mode: club.category === 'putter' ? 'roll' : 'flight',
    surface: terrainSurface,
    time: 0,
  };
}

function curveValue(curve: [number, number][], power: number): number {
  if (curve.length === 0) return 0;
  for (let i = 1; i < curve.length; i += 1) {
    const previous = curve[i - 1]!;
    const current = curve[i]!;
    if (power <= current[0]) {
      const t = (power - previous[0]) / Math.max(1e-9, current[0] - previous[0]);
      return previous[1] + (current[1] - previous[1]) * Math.max(0, Math.min(1, t));
    }
  }
  return curve[curve.length - 1]![1];
}
