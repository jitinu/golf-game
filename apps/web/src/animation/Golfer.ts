import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { ClubDef } from '@golf/sim';
import { createClubModel } from './ClubModels.js';

export type SwingType = 'swing_full' | 'swing_chip' | 'putt';

/** Normalised time within each clip at which the club face meets the ball. Physics launches here, never from the animation. */
export const IMPACT_TIME: Record<SwingType, number> = { swing_full: 0.62, swing_chip: 0.6, putt: 0.55 };
const CLIP_DURATION: Record<SwingType | 'celebrate', number> = { swing_full: 1.4, swing_chip: 1.1, putt: 1.0, celebrate: 1.4 };
const GOLFER_MODEL = '/models/golfer.glb';
const BALL_RADIUS = 0.02135;
/** Golfer stands this far to the side of the ball (right-handed address, ball off the left heel). */
const STANCE_OFFSET = 0.75;

interface Rig {
  group: THREE.Group;
  socket: THREE.Object3D;
}

function limb(material: THREE.Material, radius: number, length: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 10), material);
  mesh.position.y = -length / 2;
  mesh.castShadow = true;
  return mesh;
}

/** Simple jointed mannequin using Mixamo-style bone names so a real GLB rig can replace it 1:1. */
function proceduralGolfer(): Rig {
  const group = new THREE.Group();
  const skin = new THREE.MeshPhysicalMaterial({ color: 0xc98f68, roughness: 0.65, sheen: 0.4, sheenColor: new THREE.Color(0xffd5c0) });
  const shirt = new THREE.MeshStandardMaterial({ color: 0x2a6f9e, roughness: 0.92 });
  const trousers = new THREE.MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.95 });
  const shoes = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
  const cap = new THREE.MeshStandardMaterial({ color: 0x1f2a36, roughness: 0.9 });

  const hips = new THREE.Object3D();
  hips.name = 'mixamorigHips';
  hips.position.y = 0.98;
  group.add(hips);

  const spine = new THREE.Object3D();
  spine.name = 'mixamorigSpine';
  spine.position.y = 0.1;
  hips.add(spine);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.42, 6, 14), shirt);
  torso.position.y = 0.3;
  torso.castShadow = true;
  spine.add(torso);
  const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.12, 4, 12), trousers);
  pelvis.position.y = -0.02;
  pelvis.castShadow = true;
  hips.add(pelvis);

  const neck = new THREE.Object3D();
  neck.name = 'mixamorigNeck';
  neck.position.y = 0.6;
  spine.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 18, 14), skin);
  head.name = 'mixamorigHead';
  head.position.y = 0.13;
  head.castShadow = true;
  neck.add(head);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.05, 18), cap);
  brim.position.y = 0.09;
  head.add(brim);

  for (const side of [-1, 1] as const) {
    const suffix = side < 0 ? 'Left' : 'Right';
    const shoulder = new THREE.Object3D();
    shoulder.name = `mixamorig${suffix}Arm`;
    shoulder.position.set(side * 0.21, 0.52, 0);
    spine.add(shoulder);
    shoulder.add(limb(shirt, 0.05, 0.28));
    const elbow = new THREE.Object3D();
    elbow.name = `mixamorig${suffix}ForeArm`;
    elbow.position.y = -0.3;
    shoulder.add(elbow);
    elbow.add(limb(skin, 0.042, 0.27));
    const hand = new THREE.Object3D();
    hand.name = `mixamorig${suffix}Hand`;
    hand.position.y = -0.3;
    elbow.add(hand);

    const upLeg = new THREE.Object3D();
    upLeg.name = `mixamorig${suffix}UpLeg`;
    upLeg.position.set(side * 0.1, -0.05, 0);
    hips.add(upLeg);
    upLeg.add(limb(trousers, 0.075, 0.42));
    const leg = new THREE.Object3D();
    leg.name = `mixamorig${suffix}Leg`;
    leg.position.y = -0.46;
    upLeg.add(leg);
    leg.add(limb(trousers, 0.06, 0.4));
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.26), shoes);
    foot.position.set(0, -0.47, 0.06);
    foot.castShadow = true;
    leg.add(foot);
  }

  const rightHand = group.getObjectByName('mixamorigRightHand');
  const socket = new THREE.Object3D();
  socket.name = 'ClubSocket';
  socket.rotation.x = -0.35;
  rightHand?.add(socket);

  // Address posture: knees flexed, spine tilted toward the ball, arms hanging to the grip.
  spine.rotation.x = 0.45;
  for (const suffix of ['Left', 'Right']) {
    const arm = group.getObjectByName(`mixamorig${suffix}Arm`);
    const forearm = group.getObjectByName(`mixamorig${suffix}ForeArm`);
    const upLeg = group.getObjectByName(`mixamorig${suffix}UpLeg`);
    const leg = group.getObjectByName(`mixamorig${suffix}Leg`);
    if (arm) arm.rotation.set(0.55, 0, suffix === 'Left' ? 0.28 : -0.28);
    if (forearm) forearm.rotation.x = -0.15;
    if (upLeg) upLeg.rotation.x = -0.18;
    if (leg) leg.rotation.x = 0.35;
  }
  return { group, socket };
}

function quaternionTrack(name: string, times: number[], eulers: Array<[number, number, number]>): THREE.QuaternionKeyframeTrack {
  const values: number[] = [];
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  eulers.forEach(([x, y, z]) => {
    quaternion.setFromEuler(euler.set(x, y, z));
    values.push(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  });
  return new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, values);
}

/** Procedural swing: backswing → top → downswing → impact → follow-through; scaled by amplitude for chips and putts. */
function swingClip(name: SwingType, amplitude: number): THREE.AnimationClip {
  const duration = CLIP_DURATION[name];
  const impact = IMPACT_TIME[name] * duration;
  const top = impact * 0.62;
  const times = [0, top, impact, Math.min(duration, impact + 0.25), duration];
  const a = amplitude;
  return new THREE.AnimationClip(name, duration, [
    quaternionTrack('mixamorigHips', times, [
      [0, 0, 0],
      [0, 0.45 * a, 0],
      [0, -0.2 * a, 0],
      [0, -0.9 * a, 0],
      [0, -1.1 * a, 0],
    ]),
    quaternionTrack('mixamorigSpine', times, [
      [0.45, 0, 0],
      [0.45, 1.3 * a, 0.05 * a],
      [0.45, -0.1 * a, 0],
      [0.4, -1.5 * a, -0.1 * a],
      [0.3, -1.9 * a, -0.15 * a],
    ]),
    quaternionTrack('mixamorigRightArm', times, [
      [0.55, 0, -0.28],
      [-1.6 * a + 0.55 * (1 - a), 0.4 * a, -1.1 * a - 0.28 * (1 - a)],
      [0.65, 0, -0.25],
      [1.4 * a + 0.55 * (1 - a), -0.3 * a, 0.8 * a - 0.28 * (1 - a)],
      [1.9 * a + 0.55 * (1 - a), -0.4 * a, 1.2 * a - 0.28 * (1 - a)],
    ]),
    quaternionTrack('mixamorigLeftArm', times, [
      [0.55, 0, 0.28],
      [-1.4 * a + 0.55 * (1 - a), -0.2 * a, -0.6 * a + 0.28 * (1 - a)],
      [0.65, 0, 0.25],
      [1.5 * a + 0.55 * (1 - a), 0.4 * a, 1.3 * a + 0.28 * (1 - a)],
      [2 * a + 0.55 * (1 - a), 0.5 * a, 1.6 * a + 0.28 * (1 - a)],
    ]),
    quaternionTrack('mixamorigRightForeArm', times, [
      [-0.15, 0, 0],
      [-1.6 * a - 0.15 * (1 - a), 0, 0],
      [-0.1, 0, 0],
      [-0.3, 0, 0],
      [-1.2 * a - 0.15 * (1 - a), 0, 0],
    ]),
    quaternionTrack('mixamorigNeck', times, [
      [0, 0, 0],
      [0, -0.35 * a, 0],
      [0, 0, 0],
      [0, 0.4 * a, 0],
      [-0.4 * a, 1 * a, 0],
    ]),
  ]);
}

function celebrateClip(): THREE.AnimationClip {
  const duration = CLIP_DURATION.celebrate;
  const times = [0, duration * 0.3, duration * 0.6, duration];
  return new THREE.AnimationClip('celebrate', duration, [
    quaternionTrack('mixamorigRightArm', times, [
      [0.55, 0, -0.28],
      [-2.8, 0, -0.5],
      [-2.9, 0, -0.3],
      [0.55, 0, -0.28],
    ]),
    quaternionTrack('mixamorigLeftArm', times, [
      [0.55, 0, 0.28],
      [-2.8, 0, 0.5],
      [-2.9, 0, 0.3],
      [0.55, 0, 0.28],
    ]),
    quaternionTrack('mixamorigSpine', times, [
      [0.45, 0, 0],
      [-0.1, 0, 0],
      [-0.15, 0, 0],
      [0.45, 0, 0],
    ]),
  ]);
}

export class Golfer {
  readonly group = new THREE.Group();
  private rig: Rig;
  private mixer: THREE.AnimationMixer;
  private club: THREE.Group | undefined;
  private clubDef: ClubDef | undefined;
  private pending: { resolve: () => void; impactAt: number; elapsed: number; fired: boolean } | undefined;
  private readonly clips = new Map<string, THREE.AnimationClip>();

  constructor(renderer?: THREE.WebGLRenderer) {
    this.rig = proceduralGolfer();
    this.group.add(this.rig.group);
    this.mixer = new THREE.AnimationMixer(this.rig.group);
    this.clips.set('swing_full', swingClip('swing_full', 1));
    this.clips.set('swing_chip', swingClip('swing_chip', 0.45));
    this.clips.set('putt', swingClip('putt', 0.15));
    this.clips.set('celebrate', celebrateClip());
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) object.castShadow = true;
    });
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    if (renderer) loader.setKTX2Loader(new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer));
    void loader
      .loadAsync(GOLFER_MODEL)
      .then((asset) => this.adoptModel(asset.scene, asset.animations))
      .catch(() => undefined);
  }

  /** Replace the mannequin with an authored GLB whose skeleton exposes a `ClubSocket` node and Mixamo clip names. */
  private adoptModel(scene: THREE.Group, animations: THREE.AnimationClip[]): void {
    const socket = scene.getObjectByName('ClubSocket') ?? scene.getObjectByName('mixamorigRightHand');
    if (!socket) return;
    this.mixer.stopAllAction();
    this.group.remove(this.rig.group);
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) object.castShadow = true;
    });
    this.rig = { group: scene, socket };
    this.group.add(scene);
    this.mixer = new THREE.AnimationMixer(scene);
    animations.forEach((clip) => this.clips.set(clip.name, clip));
    if (this.clubDef) this.setClub(this.clubDef);
  }

  setClub(club: ClubDef): void {
    if (this.clubDef?.id === club.id && this.club) return;
    if (this.club) this.rig.socket.remove(this.club);
    this.clubDef = club;
    this.club = createClubModel(club);
    this.rig.socket.add(this.club);
  }

  placeForBall(position: { x: number; y: number; z: number }, yaw: number): void {
    this.faceAim(position, yaw);
  }

  /** Right-handed address: golfer stands perpendicular to the target line, ball in front of the left foot. */
  faceAim(ball: { x: number; y: number; z: number }, yaw: number): void {
    const forwardX = Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);
    const rightX = -forwardZ;
    const rightZ = forwardX;
    this.group.position.set(ball.x - rightX * STANCE_OFFSET, ball.y - BALL_RADIUS, ball.z - rightZ * STANCE_OFFSET);
    this.group.rotation.y = yaw + Math.PI / 2;
  }

  /** Resolves at the clip's impact time so the ball launches on the exact frame the club reaches it. */
  playSwing(type: SwingType): Promise<void> {
    const clip = this.clips.get(type);
    if (!clip) return Promise.resolve();
    this.mixer.stopAllAction();
    const action = this.mixer.clipAction(clip);
    action.reset().setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    return new Promise((resolve) => {
      this.pending = { resolve, impactAt: clip.duration * IMPACT_TIME[type], elapsed: 0, fired: false };
    });
  }

  celebrate(): void {
    const clip = this.clips.get('celebrate');
    if (!clip) return;
    this.mixer.stopAllAction();
    const action = this.mixer.clipAction(clip);
    action.reset().setLoop(THREE.LoopOnce, 1).play();
  }

  update(dtSeconds: number): void {
    this.mixer.update(dtSeconds);
    if (!this.pending || this.pending.fired) return;
    this.pending.elapsed += dtSeconds;
    if (this.pending.elapsed >= this.pending.impactAt) {
      this.pending.fired = true;
      this.pending.resolve();
      this.pending = undefined;
    }
  }
}
