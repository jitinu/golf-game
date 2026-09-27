import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ClubDef } from '@golf/sim';

export type SwingType = 'swing_full' | 'swing_chip' | 'putt';
export const IMPACT_TIME: Record<SwingType | 'idle' | 'walk' | 'celebrate', number> = {
  idle: 0.62,
  swing_full: 0.62,
  swing_chip: 0.62,
  putt: 0.62,
  walk: 0.62,
  celebrate: 0.62,
};

function proceduralGolfer(): { root: THREE.Group; hand: THREE.Object3D } {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.9, 6, 12), new THREE.MeshStandardMaterial({ color: 0x295a83 }));
  body.position.y = 0.85;
  root.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshStandardMaterial({ color: 0xd7a77d }));
  head.position.y = 1.65;
  root.add(head);
  const hand = new THREE.Object3D();
  hand.position.set(0.28, 1.05, 0);
  root.add(hand);
  [-1, 1].forEach((side) => {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.7, 8), new THREE.MeshStandardMaterial({ color: 0xd7a77d }));
    arm.position.set(side * 0.27, 1.15, 0);
    arm.rotation.z = side * 0.35;
    root.add(arm);
  });
  return { root, hand };
}

function createClub(club: ClubDef): THREE.Group {
  const group = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 1.05, 8), new THREE.MeshStandardMaterial({ color: 0xbfc6ce, metalness: 0.7 }));
  shaft.position.y = -0.5;
  group.add(shaft);
  const head = new THREE.Mesh(
    club.category === 'putter' ? new THREE.BoxGeometry(0.18, 0.06, 0.08) : new THREE.SphereGeometry(0.11, 10, 6),
    new THREE.MeshStandardMaterial({ color: club.category === 'driver' ? 0x171b24 : 0x777d87, metalness: 0.8 }),
  );
  head.position.y = -1.05;
  group.add(head);
  return group;
}

export class Golfer {
  readonly group: THREE.Group;
  private readonly mixer: THREE.AnimationMixer;
  private readonly hand: THREE.Object3D;
  private club: THREE.Group | undefined;

  constructor() {
    const fallback = proceduralGolfer();
    this.group = fallback.root;
    this.hand = fallback.hand;
    this.mixer = new THREE.AnimationMixer(this.group);
    void new GLTFLoader().loadAsync('/models/golfer.glb').then((asset) => {
      this.group.clear();
      this.group.add(asset.scene);
    }).catch(() => undefined);
  }

  setClub(club: ClubDef): void {
    if (this.club) this.hand.remove(this.club);
    this.club = createClub(club);
    this.club.rotation.z = Math.PI;
    this.hand.add(this.club);
  }

  faceAim(yaw: number): void {
    this.group.rotation.y = yaw;
  }

  placeForBall(position: THREE.Vector3, yaw: number): void {
    this.group.position.copy(position);
    this.group.position.x -= Math.cos(yaw) * 0.65;
    this.group.position.z -= Math.sin(yaw) * 0.65;
    this.faceAim(yaw);
  }

  update(deltaSeconds: number): void {
    this.mixer.update(deltaSeconds);
  }

  playSwing(type: SwingType): Promise<void> {
    const duration = type === 'putt' ? 0.8 : 1.1;
    const track = new THREE.NumberKeyframeTrack('.rotation[z]', [0, duration * 0.45, duration * 0.62, duration], [0.1, -1.1, 0.4, 0.1]);
    const clip = new THREE.AnimationClip(type, duration, [track]);
    const action = this.mixer.clipAction(clip);
    action.reset().setLoop(THREE.LoopOnce, 1).play();
    return new Promise((resolve) => {
      const impactDelay = duration * IMPACT_TIME[type] * 1000;
      window.setTimeout(resolve, impactDelay);
    });
  }
}
