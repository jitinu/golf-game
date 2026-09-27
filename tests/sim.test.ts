import { describe, expect, it } from 'vitest';
import {
  CLUBS,
  SurfaceId,
  computeAimYaw,
  createRng,
  simulateShot,
  shotToInitialState,
  type SimWorld,
} from '@golf/sim';

const flatWorld = (cup = { x: 1000, y: 0, z: 1000 }): SimWorld => ({
  terrain: {
    heightAt: () => 0,
    normalAt: () => ({ x: 0, y: 1, z: 0 }),
    surfaceAt: () => SurfaceId.Fairway,
  },
  cup: { position: cup, radius: 0.054, depth: 0.1 },
  aero: { airDensity: 1.225, dragMultiplier: 1, liftMultiplier: 1, spinDecayPerSecond: 0.07 },
});

describe('simulation golden shots', () => {
  it('uses the documented aim convention', () => {
    expect(computeAimYaw({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -10 })).toBeCloseTo(0);
    expect(computeAimYaw({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 })).toBeCloseTo(Math.PI / 2);
  });

  it('drives a realistic full-power driver', () => {
    const initial = shotToInitialState(
      { clubId: 'driver', aimYaw: 0, power: 1, accuracy: 0, seed: 1 },
      CLUBS.driver!,
      { x: 0, y: 0.02135, z: 0 },
      SurfaceId.Fairway,
      createRng(1),
    );
    const result = simulateShot(initial, flatWorld());
    expect(result.carryDistance).toBeGreaterThan(230);
    expect(result.carryDistance).toBeLessThan(265);
    expect(result.apexHeight).toBeGreaterThan(25);
    expect(result.apexHeight).toBeLessThan(40);
    expect(result.totalDistance).toBeGreaterThanOrEqual(result.carryDistance);
  });

  it('drives a realistic seven iron', () => {
    const initial = shotToInitialState(
      { clubId: '7-iron', aimYaw: 0, power: 1, accuracy: 0 },
      CLUBS['7-iron']!,
      { x: 0, y: 0.02135, z: 0 },
      SurfaceId.Fairway,
      createRng(1),
    );
    const result = simulateShot(initial, flatWorld());
    expect(result.carryDistance).toBeGreaterThan(140);
    expect(result.carryDistance).toBeLessThan(165);
  });

  it('stops a half-power putt in the expected range', () => {
    const initial = shotToInitialState(
      { clubId: 'putter', aimYaw: 0, power: 0.5, accuracy: 0 },
      CLUBS.putter!,
      { x: 0, y: 0.02135, z: 0 },
      SurfaceId.Green,
      createRng(1),
    );
    const result = simulateShot(initial, { ...flatWorld(), terrain: { ...flatWorld().terrain, surfaceAt: () => SurfaceId.Green } });
    expect(result.totalDistance).toBeGreaterThan(3);
    expect(result.totalDistance).toBeLessThan(6);
    expect(result.final.mode).toBe('rest');
  });

  it('rolls farther downhill than uphill', () => {
    const slope = (rise: number) => ({
      heightAt: (x: number, z: number) => rise * z,
      normalAt: () => ({ x: 0, y: 1, z: -rise }),
      surfaceAt: () => SurfaceId.Green,
    });
    const start = shotToInitialState(
      { clubId: 'putter', aimYaw: 0, power: 0.5, accuracy: 0 },
      CLUBS.putter!,
      { x: 0, y: 0.02135, z: 0 },
      SurfaceId.Green,
      createRng(1),
    );
    const downhill = simulateShot({ ...start }, { ...flatWorld(), terrain: slope(0.04) });
    const uphill = simulateShot({ ...start }, { ...flatWorld(), terrain: slope(-0.04) });
    expect(downhill.totalDistance).toBeGreaterThan(uphill.totalDistance);
  });

  it('captures a slow straight putt and rejects a fast edge putt', () => {
    const terrain = { heightAt: () => 0, normalAt: () => ({ x: 0, y: 1, z: 0 }), surfaceAt: () => SurfaceId.Green };
    const world: SimWorld = { terrain, cup: { position: { x: 0, y: 0, z: -1 }, radius: 0.054, depth: 0.1 }, aero: { airDensity: 1.225, dragMultiplier: 1, liftMultiplier: 1, spinDecayPerSecond: 0.07 } };
    const slow = simulateShot({ position: { x: 0, y: 0.02135, z: 0 }, velocity: { x: 0, y: 0, z: -1 }, angularVelocity: { x: 0, y: 0, z: 0 }, mode: 'roll', surface: SurfaceId.Green, time: 0 }, world);
    expect(slow.holed).toBe(true);
    const fast = simulateShot({ position: { x: 0.05, y: 0.02135, z: 0 }, velocity: { x: 0, y: 0, z: -3 }, angularVelocity: { x: 0, y: 0, z: 0 }, mode: 'roll', surface: SurfaceId.Green, time: 0 }, world);
    expect(fast.holed).toBe(false);
  });

  it('is deterministic for a seed', () => {
    const command = { clubId: 'driver', aimYaw: 0.1, power: 0.8, accuracy: 0.2, seed: 44 };
    const a = simulateShot(shotToInitialState(command, CLUBS.driver!, { x: 0, y: 0.02135, z: 0 }, SurfaceId.Fairway, createRng(44)), flatWorld(), { record: true });
    const b = simulateShot(shotToInitialState(command, CLUBS.driver!, { x: 0, y: 0.02135, z: 0 }, SurfaceId.Fairway, createRng(44)), flatWorld(), { record: true });
    expect(b.trajectory).toEqual(a.trajectory);
  });
});
