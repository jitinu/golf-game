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

/** Bones the procedural clips drive, by Mixamo name without the `mixamorig` prefix. */
const RIG_BONES = ['Hips', 'Spine', 'Neck', 'RightArm', 'LeftArm', 'RightForeArm', 'LeftForeArm', 'RightUpLeg', 'LeftUpLeg', 'RightLeg', 'LeftLeg'] as const;
type RigBone = (typeof RIG_BONES)[number];

/**
 * Address-pose corrections applied on top of the procedural clips when an authored A-pose rig replaces the
 * straight-limbed mannequin (which bakes its address stance into its rest pose): bring the arms in to the grip,
 * flex the knees and tilt into the ball.
 */
const ADDRESS_OFFSET: Partial<Record<RigBone, [number, number, number]>> = {
  LeftArm: [0, 0, -0.5],
  RightArm: [0, 0, 0.5],
  LeftUpLeg: [-0.2, 0, 0.05],
  RightUpLeg: [-0.2, 0, -0.05],
  LeftLeg: [0.35, 0, 0],
  RightLeg: [0.35, 0, 0],
};

function stripPrefix(name: string): string {
  return name.replace(/^mixamorig:?/, '');
}

function findBone(root: THREE.Object3D, bone: string): THREE.Object3D | undefined {
  let found: THREE.Object3D | undefined;
  root.traverse((object) => {
    if (!found && stripPrefix(object.name) === bone) found = object;
  });
  return found;
}

/**
 * Converts a clip authored in character space for the identity-rest mannequin into bone-local rotations for a
 * skinned rig: `local = restLocal · restWorld⁻¹ · (D · offset) · restWorld`, so every delta still means "rotate
 * this limb about the character's axes", whatever the rig's bone axes are.
 */
function retargetClip(clip: THREE.AnimationClip, root: THREE.Object3D): THREE.AnimationClip {
  const rootWorld = new THREE.Quaternion();
  root.updateWorldMatrix(true, true);
  root.getWorldQuaternion(rootWorld);
  const tracks: THREE.KeyframeTrack[] = [];
  for (const track of clip.tracks) {
    const match = /^(.*)\.quaternion$/.exec(track.name);
    const bone = match ? findBone(root, stripPrefix(match[1]!)) : undefined;
    if (!match || !bone || !(track instanceof THREE.QuaternionKeyframeTrack)) continue;
    const restLocal = bone.quaternion.clone();
    const restWorld = new THREE.Quaternion();
    bone.getWorldQuaternion(restWorld).premultiply(rootWorld.clone().invert());
    const restWorldInverse = restWorld.clone().invert();
    const offsetEuler = ADDRESS_OFFSET[stripPrefix(match[1]!) as RigBone];
    const offset = offsetEuler ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...offsetEuler)) : new THREE.Quaternion();
    const values = Array.from(track.values);
    const delta = new THREE.Quaternion();
    for (let index = 0; index < values.length; index += 4) {
      delta.set(values[index]!, values[index + 1]!, values[index + 2]!, values[index + 3]!).multiply(offset);
      const local = restLocal.clone().multiply(restWorldInverse).multiply(delta).multiply(restWorld);
      values[index] = local.x;
      values[index + 1] = local.y;
      values[index + 2] = local.z;
      values[index + 3] = local.w;
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, Array.from(track.times), values));
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/** Bones with an address offset that no clip animates (legs) get the offset baked into their pose once. */
function applyStaticOffsets(root: THREE.Object3D, tracked: Set<string>): void {
  const rootWorld = new THREE.Quaternion();
  root.getWorldQuaternion(rootWorld);
  for (const name of RIG_BONES) {
    const offsetEuler = ADDRESS_OFFSET[name];
    const bone = findBone(root, name);
    if (!offsetEuler || !bone || tracked.has(name)) continue;
    const restWorld = new THREE.Quaternion();
    bone.getWorldQuaternion(restWorld).premultiply(rootWorld.clone().invert());
    const offset = new THREE.Quaternion().setFromEuler(new THREE.Euler(...offsetEuler));
    bone.quaternion.multiply(restWorld.clone().invert()).multiply(offset).multiply(restWorld);
  }
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
    if (arm) arm.rotation.set(-0.6, 0, suffix === 'Left' ? -0.36 : 0.36);
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
  // Character space: faces the ball (+Z), target to its left (+X). Negative X on an arm raises it toward the ball,
  // negative Y on hips/spine turns the body away from the target (backswing), positive toward it.
  const mix = (rest: number, swing: number): number => rest * (1 - a) + swing * a;
  return new THREE.AnimationClip(name, duration, [
    quaternionTrack('mixamorigHips', times, [
      [0, 0, 0],
      [0, -0.4 * a, 0],
      [0, 0.25 * a, 0],
      [0, 0.8 * a, 0],
      [0, 1.0 * a, 0],
    ]),
    quaternionTrack('mixamorigSpine', times, [
      [0.45, 0, 0],
      [0.42, -1.25 * a, -0.08 * a],
      [0.45, 0.15 * a, 0.05 * a],
      [0.35, 1.3 * a, 0.12 * a],
      [0.2, 1.7 * a, 0.15 * a],
    ]),
    quaternionTrack('mixamorigRightArm', times, [
      [-0.6, 0, 0.36],
      [mix(-0.6, -1.35), 0, mix(0.36, 0.2)],
      [-0.65, 0, 0.35],
      [mix(-0.6, -1.3), 0, mix(0.36, 0.7)],
      [mix(-0.6, -1.5), 0, mix(0.36, 0.9)],
    ]),
    quaternionTrack('mixamorigLeftArm', times, [
      [-0.6, 0, -0.36],
      [mix(-0.6, -1.45), 0, mix(-0.36, -0.55)],
      [-0.65, 0, -0.35],
      [mix(-0.6, -1.3), 0, mix(-0.36, 0.1)],
      [mix(-0.6, -1.5), 0, mix(-0.36, 0.3)],
    ]),
    quaternionTrack('mixamorigRightForeArm', times, [
      [-0.15, 0, 0],
      [mix(-0.15, -1.5), 0, 0],
      [-0.12, 0, 0],
      [-0.25, 0, 0],
      [mix(-0.15, -0.6), 0, 0],
    ]),
    quaternionTrack('mixamorigLeftForeArm', times, [
      [-0.15, 0, 0],
      [-0.15, 0, 0],
      [-0.12, 0, 0],
      [mix(-0.15, -0.7), 0, 0],
      [mix(-0.15, -1.3), 0, 0],
    ]),
    quaternionTrack('mixamorigNeck', times, [
      [0.5, 0, 0],
      [0.5, 0.3 * a, 0],
      [0.5, 0, 0],
      [0.3, -0.4 * a, 0],
      [-0.1 * a, -1.0 * a, 0],
    ]),
  ]);
}

function celebrateClip(): THREE.AnimationClip {
  const duration = CLIP_DURATION.celebrate;
  const times = [0, duration * 0.3, duration * 0.6, duration];
  return new THREE.AnimationClip('celebrate', duration, [
    quaternionTrack('mixamorigRightArm', times, [
      [-0.6, 0, 0.36],
      [-2.8, 0, 0.5],
      [-2.9, 0, 0.3],
      [-0.6, 0, 0.36],
    ]),
    quaternionTrack('mixamorigLeftArm', times, [
      [-0.6, 0, -0.36],
      [-2.8, 0, -0.5],
      [-2.9, 0, -0.3],
      [-0.6, 0, -0.36],
    ]),
    quaternionTrack('mixamorigSpine', times, [
      [0.45, 0, 0],
      [-0.1, 0, 0],
      [-0.15, 0, 0],
      [0.45, 0, 0],
    ]),
    quaternionTrack('mixamorigNeck', times, [
      [0.5, 0, 0],
      [-0.3, 0, 0],
      [-0.3, 0, 0],
      [0.5, 0, 0],
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

  /**
   * Replace the mannequin with an authored GLB on a Mixamo-named skeleton (with or without the `mixamorig` prefix).
   * Authored clips win by name; missing ones are retargeted from the procedural set so any humanoid rig swings.
   */
  private adoptModel(scene: THREE.Group, animations: THREE.AnimationClip[]): void {
    const rightHand = findBone(scene, 'RightHand');
    let socket = scene.getObjectByName('ClubSocket');
    if (!socket && rightHand) {
      scene.updateWorldMatrix(true, true);
      socket = new THREE.Object3D();
      socket.name = 'ClubSocket';
      const handWorld = new THREE.Quaternion();
      rightHand.getWorldQuaternion(handWorld);
      const sceneWorld = new THREE.Quaternion();
      scene.getWorldQuaternion(sceneWorld);
      // Socket axes match the character's at rest so the club hangs straight down, then a slight forward lean of the shaft.
      socket.quaternion.copy(handWorld.invert().multiply(sceneWorld)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.15, 0, 0)));
      socket.position.set(0, -0.04, 0.02);
      rightHand.add(socket);
    }
    if (!socket) return;
    this.mixer.stopAllAction();
    this.group.remove(this.rig.group);
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        object.frustumCulled = false;
      }
    });
    const authored = new Set(animations.map((clip) => clip.name));
    const tracked = new Set<string>();
    for (const [name, clip] of this.clips) {
      if (authored.has(name)) continue;
      const retargeted = retargetClip(clip, scene);
      retargeted.tracks.forEach((track) => tracked.add(stripPrefix(track.name.replace(/\.quaternion$/, ''))));
      this.clips.set(name, retargeted);
    }
    if (!authored.has('swing_full')) applyStaticOffsets(scene, tracked);
    animations.forEach((clip) => this.clips.set(clip.name, clip));
    this.rig = { group: scene, socket };
    this.group.add(scene);
    this.mixer = new THREE.AnimationMixer(scene);
    this.mixer.clipAction(this.clips.get('swing_full')!).play().paused = true;
    if (this.club) {
      this.rig.socket.add(this.club);
    }
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
    this.group.rotation.y = Math.PI / 2 - yaw;
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
