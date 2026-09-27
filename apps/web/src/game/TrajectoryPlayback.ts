import type { BallState } from '@golf/sim';

export const FIXED_DT = 1000 / 120;

export class TrajectoryPlayback {
  private trajectory: BallState[] = [];
  private accumulator = 0;
  private index = 0;

  start(trajectory: BallState[]): void {
    this.trajectory = trajectory;
    this.accumulator = 0;
    this.index = 0;
  }

  update(dtMs: number): void {
    if (this.done) return;
    this.accumulator += Math.max(0, Math.min(100, dtMs));
    while (this.accumulator >= FIXED_DT && this.index < this.trajectory.length - 1) {
      this.accumulator -= FIXED_DT;
      this.index += 1;
    }
  }

  get done(): boolean {
    return this.trajectory.length === 0 || this.index >= this.trajectory.length - 1;
  }

  get position(): { x: number; y: number; z: number } {
    const current = this.trajectory[this.index];
    const next = this.trajectory[Math.min(this.index + 1, this.trajectory.length - 1)];
    if (!current || !next) return { x: 0, y: 0, z: 0 };
    const alpha = this.done ? 0 : this.accumulator / FIXED_DT;
    return {
      x: current.position.x + (next.position.x - current.position.x) * alpha,
      y: current.position.y + (next.position.y - current.position.y) * alpha,
      z: current.position.z + (next.position.z - current.position.z) * alpha,
    };
  }
}
