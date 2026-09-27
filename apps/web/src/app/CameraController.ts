import * as THREE from 'three';
import { holeDistance, type Vec3 } from '@golf/sim';

export type CameraMode = 'aim' | 'follow' | 'green';

const GREEN_RADIUS_M = 25;

export class CameraController {
  mode: CameraMode = 'aim';
  private readonly target = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly lookDirection = new THREE.Vector3(0, 0, -1);
  private readonly scratch = new THREE.Vector3();

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  snapToAim(ball: Vec3, pin: Vec3, aimYaw: number): void {
    this.mode = 'aim';
    this.compute(ball, pin, aimYaw);
    this.camera.position.copy(this.desired);
    this.lookDirection.copy(this.target).sub(this.camera.position).normalize();
    this.camera.lookAt(this.target);
  }

  update(ball: Vec3, pin: Vec3, aimYaw: number, dtSeconds: number): void {
    if (this.mode === 'aim' && holeDistance(ball, pin) < GREEN_RADIUS_M) this.mode = 'green';
    this.compute(ball, pin, aimYaw);
    const alpha = 1 - Math.exp(-(this.mode === 'follow' ? 5 : 3) * Math.max(0, dtSeconds));
    this.camera.position.lerp(this.desired, alpha);
    this.scratch.copy(this.target).sub(this.camera.position).normalize();
    this.lookDirection.lerp(this.scratch, alpha).normalize();
    this.camera.lookAt(this.scratch.copy(this.camera.position).add(this.lookDirection));
  }

  private compute(ball: Vec3, pin: Vec3, aimYaw: number): void {
    const aim = this.scratch.set(Math.sin(aimYaw), 0, -Math.cos(aimYaw));
    const ballVector = new THREE.Vector3(ball.x, ball.y, ball.z);
    const pinVector = new THREE.Vector3(pin.x, pin.y, pin.z);
    if (this.mode === 'aim') {
      this.desired.copy(ballVector).addScaledVector(aim, -7).add(new THREE.Vector3(0, 2.4, 0));
      this.target.copy(ballVector).addScaledVector(aim, 25).add(new THREE.Vector3(0, 1.5, 0));
    } else if (this.mode === 'green') {
      const toBall = ballVector.clone().sub(pinVector).setY(0);
      const back = toBall.lengthSq() > 0.01 ? toBall.normalize() : aim.clone().negate();
      this.desired.copy(ballVector).addScaledVector(back, 4).add(new THREE.Vector3(0, 2.2, 0));
      this.target.copy(ballVector).lerp(pinVector, 0.5).add(new THREE.Vector3(0, 0.3, 0));
    } else {
      const height = 3 + Math.min(12, ball.y - Math.min(ball.y, pin.y)) * 0.4;
      this.desired.copy(ballVector).addScaledVector(aim, -9).add(new THREE.Vector3(0, height, 0));
      this.target.copy(ballVector);
    }
  }
}
