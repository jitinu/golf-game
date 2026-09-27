import { SurfaceId, type LoadedCourse } from '@golf/course-format';
import { CLUBS, createRng, shotToInitialState, simulateShot, type BallState, type ShotResult, type Vec3 } from '@golf/sim';
import type { ShotCommand, ShotRecord } from '@golf/protocol';

export interface ResolvedShot {
  result: ShotResult;
  trajectory: BallState[];
  record: ShotRecord;
  drop: Vec3;
}

export class HoleController {
  private rng = createRng(0xdecafbad);

  constructor(readonly course: LoadedCourse, readonly holeNumber: number) {}

  teePosition(): Vec3 {
    const hole = this.course.manifest.holes[this.holeNumber - 1];
    const tee = hole?.tees.find((value) => value.id === 'middle') ?? hole?.tees[0];
    if (!tee) throw new Error(`Hole ${this.holeNumber} has no tee`);
    return { x: tee.position.x, y: this.course.sampler.heightAt(tee.position.x, tee.position.z) + 0.02135, z: tee.position.z };
  }

  cup() {
    return this.course.cupFor(this.holeNumber);
  }

  resolve(command: ShotCommand, from: Vec3, stroke: number): ResolvedShot {
    const club = CLUBS[command.clubId] ?? CLUBS.driver;
    if (!club) throw new Error('Driver club is unavailable');
    const surface = this.course.sampler.surfaceAt(from.x, from.z);
    const initial = shotToInitialState(command, club, from, surface, this.rng);
    const result = simulateShot(initial, {
      terrain: this.course.sampler,
      cup: this.cup(),
      aero: { airDensity: 1.225, dragMultiplier: 1, liftMultiplier: 1, spinDecayPerSecond: 0.07 },
    }, { record: true, maxTime: 15 });
    const terminal = result.final;
    const lastSafe = [...result.trajectory].reverse().find((state) => state.surface === SurfaceId.Fairway || state.surface === SurfaceId.Rough || state.surface === SurfaceId.FirstCut)?.position ?? from;
    const water = result.events.some((event) => event.type === 'water');
    const oob = result.events.some((event) => event.type === 'oob');
    const drop = water ? lastSafe : oob ? from : terminal.position;
    const outcome = water ? 'water' : oob ? 'oob' : result.holed ? 'holed' : 'flight';
    return {
      result,
      trajectory: result.trajectory,
      drop,
      record: { hole: this.holeNumber, stroke, command, from, to: terminal.position, result: outcome },
    };
  }

  suggestClub(distance: number): string {
    return Object.values(CLUBS).sort((a, b) => a.maxCarryHintM - b.maxCarryHintM).find((club) => club.maxCarryHintM >= distance)?.id ?? 'driver';
  }
}
