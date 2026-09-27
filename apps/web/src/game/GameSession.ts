import { loadCourse, type LoadedCourse } from '@golf/course-format';
import { CLUBS, computeAimYaw, holeDistance, type ShotCommand, type Vec3 } from '@golf/sim';
import type { FinishRunResponse, RunTicket, ShotRecord } from '@golf/protocol';
import { ApiClient, type ScoreService } from '../net/ApiClient.js';
import { HoleController, type ResolvedShot } from './HoleController.js';
import { initialGameState, type GameState } from './GameState.js';
import type { Golfer, SwingType } from '../animation/Golfer.js';

export type SessionListener = (state: GameState) => void;

export class GameSession {
  readonly state = initialGameState();
  readonly shots: ShotRecord[] = [];
  readonly strokes: number[] = [];
  readonly scoreService: ScoreService;
  course: LoadedCourse | undefined;
  holeController: HoleController | undefined;
  ballPosition: Vec3 = { x: 0, y: 0, z: 0 };
  aimYaw = 0;
  selectedClub = 'driver';
  runStartedAt = 0;
  runTicket: RunTicket | null = null;
  private readonly listeners = new Set<SessionListener>();

  constructor(scoreService = new ApiClient()) {
    this.scoreService = scoreService;
  }

  onChange(listener: SessionListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener(this.state));
  }

  async start(coursePath = '/courses/pinecrest/'): Promise<void> {
    this.course = await loadCourse(coursePath);
    this.runStartedAt = performance.now();
    Object.assign(this.state, initialGameState(), { phase: 'aiming' });
    this.state.holeStrokes = [];
    this.strokes.length = 0;
    this.shots.length = 0;
    this.runTicket = null;
    this.holeController = new HoleController(this.course, 1);
    this.ballPosition = this.holeController.teePosition();
    this.configureHole();
    this.runTicket = await this.scoreService.startRun({ courseId: this.course.manifest.courseId, courseVersion: this.course.manifest.courseVersion, clientVersion: 'web-1' });
    this.notify();
  }

  private configureHole(): void {
    if (!this.course || !this.holeController) return;
    const hole = this.course.manifest.holes[this.state.hole - 1];
    const cup = this.holeController.cup();
    this.state.par = hole?.par ?? 4;
    this.state.wind = { x: this.holeController.wind.x, z: this.holeController.wind.z };
    this.state.distanceToPin = holeDistance(this.ballPosition, cup.position);
    this.state.selectedClub = this.suggestClub();
    this.selectedClub = this.state.selectedClub;
    this.aimYaw = computeAimYaw(this.ballPosition, cup.position);
    this.state.aimYaw = this.aimYaw;
  }

  suggestClub(): string {
    return this.holeController?.suggestClub(this.state.distanceToPin) ?? 'driver';
  }

  setClub(clubId: string): void {
    if (!CLUBS[clubId]) return;
    this.selectedClub = clubId;
    this.state.selectedClub = clubId;
    this.notify();
  }

  setAim(yaw: number): void {
    this.aimYaw = yaw;
    this.state.aimYaw = yaw;
    this.notify();
  }

  setCharge(power: number, accuracy = this.state.accuracy): void {
    this.state.power = power;
    this.state.accuracy = accuracy;
    this.notify();
  }

  async hit(golfer: Golfer, skipAnimation = false): Promise<ResolvedShot | undefined> {
    if (!this.holeController || this.state.phase !== 'aiming') return undefined;
    this.state.phase = 'charging';
    this.notify();
    const type: SwingType = CLUBS[this.selectedClub]?.category === 'putter' ? 'putt' : this.state.distanceToPin < 80 ? 'swing_chip' : 'swing_full';
    this.state.phase = 'resolving';
    this.notify();
    if (!skipAnimation) await golfer.playSwing(type);
    const command: ShotCommand = { clubId: this.selectedClub, aimYaw: this.aimYaw, power: this.state.power, accuracy: this.state.accuracy, seed: this.shots.length + 1 };
    const resolved = this.holeController.resolve(command, this.ballPosition, this.state.stroke);
    this.shots.push(resolved.record);
    this.notify();
    return resolved;
  }

  completeShot(resolved: ResolvedShot): void {
    const penalty = resolved.record.result === 'water' || resolved.record.result === 'oob';
    this.ballPosition = resolved.drop;
    if (resolved.result.holed) {
      this.state.phase = 'holeComplete';
      this.strokes.push(this.state.stroke);
      this.state.holeStrokes = [...this.strokes];
      this.state.message = this.scoreMessage(this.state.stroke, this.state.par);
    } else {
      this.state.stroke += penalty ? 2 : 1;
      this.state.phase = 'aiming';
      if (this.holeController) {
        const cup = this.holeController.cup().position;
        this.state.distanceToPin = holeDistance(this.ballPosition, cup);
        this.aimYaw = computeAimYaw(this.ballPosition, cup);
        this.state.aimYaw = this.aimYaw;
        this.state.selectedClub = this.suggestClub();
        this.selectedClub = this.state.selectedClub;
      }
      this.state.message = penalty ? (resolved.record.result === 'water' ? 'Water hazard · one-stroke penalty' : 'Out of bounds · one-stroke penalty') : undefined;
    }
    this.notify();
  }

  private scoreMessage(score: number, par: number): string {
    const delta = score - par;
    return delta <= -3 ? 'Albatross!' : delta === -2 ? 'Eagle!' : delta === -1 ? 'Birdie!' : delta === 0 ? 'Par' : delta === 1 ? 'Bogey' : `${delta} over par`;
  }

  nextHole(): boolean {
    if (!this.course || this.state.hole >= this.course.manifest.holes.length) {
      this.state.phase = 'scorecard';
      this.notify();
      return false;
    }
    this.state.hole += 1;
    this.state.stroke = 1;
    this.holeController = new HoleController(this.course, this.state.hole);
    this.ballPosition = this.holeController.teePosition();
    this.configureHole();
    this.state.phase = 'aiming';
    this.notify();
    return true;
  }

  requestNameEntry(): void {
    this.state.phase = 'nameEntry';
    this.notify();
  }

  async finish(playerName: string): Promise<FinishRunResponse | null> {
    if (!this.course) return null;
    const response = await this.scoreService.finishRun({
      playerName,
      holeStrokes: [...this.strokes],
      shots: [...this.shots],
      durationMs: Math.round(performance.now() - this.runStartedAt),
    }, this.runTicket);
    this.state.phase = 'leaderboard';
    this.notify();
    return response;
  }

  reset(): void {
    Object.assign(this.state, initialGameState());
    this.notify();
  }
}
