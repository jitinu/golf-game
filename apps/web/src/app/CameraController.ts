import * as THREE from 'three';
import { holeDistance, type BallState, type Vec3 } from '@golf/sim';

export type CameraMode = 'aim' | 'follow' | 'green';

const GREEN_RADIUS_M = 25;
/** Shots shorter than this stay on one camera instead of cutting to a landing view. */
const SHORT_SHOT_M = 45;
const UP = new THREE.Vector3(0, 1, 0);

interface ShotPlan {
  start: THREE.Vector3;
  landing: THREE.Vector3;
  end: THREE.Vector3;
  aim: THREE.Vector3;
  right: THREE.Vector3;
  carry: number;
  apex: number;
  phase: 'launch' | 'landing';
}

/**
 * Broadcast-style presentation: the aim camera sits low behind the golfer; on a shot it stays at the
 * tee and pans up with the ball, then hard-cuts to a landing camera as the ball comes down; on and
 * around the green a close camera frames ball and pin.
 */
export class CameraController {
  mode: CameraMode = 'aim';
  private readonly target = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly lookDirection = new THREE.Vector3(0, 0, -1);
  private readonly scratch = new THREE.Vector3();
  private readonly ballVector = new THREE.Vector3();
  private plan: ShotPlan | undefined;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly heightAt: (x: number, z: number) => number = () => Number.NEGATIVE_INFINITY,
  ) {}

  snapToAim(ball: Vec3, pin: Vec3, aimYaw: number): void {
    this.mode = 'aim';
    this.plan = undefined;
    this.compute(ball, pin, aimYaw);
    this.snap();
  }

  /** Plans launch/landing cameras from the resolved trajectory before playback starts. */
  beginShot(trajectory: BallState[], aimYaw: number): void {
    this.mode = 'follow';
    const first = trajectory[0];
    const last = trajectory[trajectory.length - 1];
    if (!first || !last) return;
    const start = new THREE.Vector3(first.position.x, first.position.y, first.position.z);
    const end = new THREE.Vector3(last.position.x, last.position.y, last.position.z);
    let apex = start.y;
    let landingState = last;
    for (const state of trajectory) {
      apex = Math.max(apex, state.position.y);
      if (state.mode !== 'flight') {
        landingState = state;
        break;
      }
    }
    const landing = new THREE.Vector3(landingState.position.x, landingState.position.y, landingState.position.z);
    const travel = end.clone().sub(start).setY(0);
    const aim = travel.lengthSq() > 1 ? travel.normalize() : new THREE.Vector3(Math.sin(aimYaw), 0, -Math.cos(aimYaw));
    this.plan = { start, landing, end, aim, right: new THREE.Vector3().crossVectors(aim, UP).normalize(), carry: landing.distanceTo(start), apex: apex - start.y, phase: 'launch' };
    this.compute(first.position, end, aimYaw);
    this.snap();
  }

  endShot(): void {
    this.plan = undefined;
  }

  update(ball: Vec3, pin: Vec3, aimYaw: number, dtSeconds: number): void {
    if (this.mode === 'aim' && holeDistance(ball, pin) < GREEN_RADIUS_M) this.mode = 'green';
    const cut = this.compute(ball, pin, aimYaw);
    if (cut) {
      this.snap();
      return;
    }
    const alpha = 1 - Math.exp(-(this.mode === 'follow' ? 4 : 3) * Math.max(0, dtSeconds));
    this.camera.position.lerp(this.desired, alpha);
    this.scratch.copy(this.target).sub(this.camera.position).normalize();
    // Track the ball tightly in flight so it never leaves the frame.
    const lookAlpha = this.mode === 'follow' ? 1 - Math.exp(-9 * Math.max(0, dtSeconds)) : alpha;
    this.lookDirection.lerp(this.scratch, lookAlpha).normalize();
    this.camera.lookAt(this.scratch.copy(this.camera.position).add(this.lookDirection));
  }

  private snap(): void {
    this.camera.position.copy(this.desired);
    this.lookDirection.copy(this.target).sub(this.camera.position).normalize();
    this.camera.lookAt(this.target);
  }

  /** Fills `desired`/`target` and keeps the camera above the terrain; returns true when the presentation just cut to a new camera. */
  private compute(ball: Vec3, pin: Vec3, aimYaw: number): boolean {
    const cut = this.frame(ball, pin, aimYaw);
    this.desired.y = Math.max(this.desired.y, this.heightAt(this.desired.x, this.desired.z) + 1.2);
    return cut;
  }

  private frame(ball: Vec3, pin: Vec3, aimYaw: number): boolean {
    const aim = this.scratch.set(Math.sin(aimYaw), 0, -Math.cos(aimYaw));
    const ballVector = this.ballVector.set(ball.x, ball.y, ball.z);
    const pinVector = new THREE.Vector3(pin.x, pin.y, pin.z);
    if (this.mode === 'aim') {
      const right = new THREE.Vector3(-aim.z, 0, aim.x);
      // Low broadcast angle: just above hip height, off the golfer's trail shoulder, looking down the line so the
      // fairway, hazards and tree line give the frame depth while the golfer stays the foreground focal point.
      this.desired.copy(ballVector).addScaledVector(aim, -4.9).addScaledVector(right, 2.8).add(new THREE.Vector3(0, 1.4, 0));
      this.target.copy(ballVector).addScaledVector(aim, 26).addScaledVector(right, 1.6).add(new THREE.Vector3(0, 0.4, 0));
      return false;
    }
    if (this.mode === 'green') {
      const toBall = ballVector.clone().sub(pinVector).setY(0);
      const back = toBall.lengthSq() > 0.01 ? toBall.normalize() : aim.clone().negate();
      this.desired.copy(ballVector).addScaledVector(back, 4).add(new THREE.Vector3(0, 2.2, 0));
      this.target.copy(ballVector).lerp(pinVector, 0.5).add(new THREE.Vector3(0, 0.3, 0));
      return false;
    }
    const plan = this.plan;
    if (!plan) {
      this.desired.copy(ballVector).addScaledVector(aim, -9).add(new THREE.Vector3(0, 3, 0));
      this.target.copy(ballVector);
      return false;
    }
    const flown = ballVector.clone().sub(plan.start).setY(0).dot(plan.aim);
    const progress = plan.carry > 1 ? THREE.MathUtils.clamp(flown / plan.carry, 0, 1) : 1;
    const height = ballVector.y - plan.start.y;
    if (plan.carry < SHORT_SHOT_M) {
      // Chips and putts: one low camera behind the start, panning with the ball.
      this.desired.copy(plan.start).addScaledVector(plan.aim, -5).addScaledVector(plan.right, 1.6).add(new THREE.Vector3(0, 2.1, 0));
      this.target.copy(ballVector).lerp(plan.end, 0.15);
      return false;
    }
    let cut = false;
    if (plan.phase === 'launch' && progress > 0.6 && height < plan.apex * 0.75) {
      plan.phase = 'landing';
      cut = true;
    }
    if (plan.phase === 'launch') {
      // Tee camera: low and behind, drifting forward and rising slightly as the ball climbs.
      const push = Math.min(10, progress * 16);
      this.desired.copy(plan.start).addScaledVector(plan.aim, -6 + push).addScaledVector(plan.right, -1.4).add(new THREE.Vector3(0, 2 + height * 0.12, 0));
      this.target.copy(ballVector);
    } else {
      // Landing camera: ahead of the touchdown point, off to the side, looking back down the line at the incoming ball.
      const rollAhead = Math.max(0, ballVector.clone().sub(plan.landing).setY(0).dot(plan.aim) - 14);
      this.desired.copy(plan.landing).addScaledVector(plan.aim, 14 + rollAhead).addScaledVector(plan.right, 7).add(new THREE.Vector3(0, 4.2, 0));
      this.target.copy(ballVector).lerp(plan.landing, height > 2 ? 0.35 : 0);
    }
    return cut;
  }
}
