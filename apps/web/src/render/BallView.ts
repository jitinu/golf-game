import * as THREE from 'three';
import type { Environment } from './Environment.js';
import { TrajectoryPlayback } from '../game/TrajectoryPlayback.js';

export class BallView {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  readonly playback = new TrajectoryPlayback();

  constructor(environment?: Environment) {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.02135, 20, 14),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0 }),
    );
    this.mesh.castShadow = true;
    environment?.setupMaterial(this.mesh.material);
  }

  place(position: { x: number; y: number; z: number }): void {
    this.mesh.position.set(position.x, position.y, position.z);
  }

  start(trajectory: import('@golf/sim').BallState[]): void {
    this.playback.start(trajectory);
  }

  update(dtMs: number): void {
    this.playback.update(dtMs);
    this.place(this.playback.position);
  }
}
