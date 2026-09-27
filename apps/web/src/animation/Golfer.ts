import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { ClubDef } from '@golf/sim';
import type { Environment } from '../render/Environment.js';
import { CLUB_MATERIALS, clubSpec, createClubModel, specForCategory } from './ClubModels.js';
import { bakeCelebration, bakeSwing, IMPACT_TIME, stanceDistance, type ClipName, type SwingType } from './SwingBaker.js';
import { SwingRig } from './SwingRig.js';

export { IMPACT_TIME, type SwingType } from './SwingBaker.js';

const GOLFER_MODEL = '/models/golfer.glb';
const BALL_RADIUS = 0.02135;

function limb(material: THREE.Material, radius: number, length: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 10), material);
  mesh.position.y = -length / 2;
  mesh.castShadow = true;
  return mesh;
}

/** Simple jointed mannequin using Mixamo-style bone names so a real GLB rig can replace it 1:1. */
function proceduralGolfer(): THREE.Group {
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
  const head = new THREE.Object3D();
  head.name = 'mixamorigHead';
  head.position.y = 0.05;
  neck.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 18, 14), skin);
  skull.position.y = 0.08;
  skull.castShadow = true;
  head.add(skull);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.05, 18), cap);
  brim.position.y = 0.09;
  skull.add(brim);

  for (const side of [-1, 1] as const) {
    const suffix = side < 0 ? 'Right' : 'Left';
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
    const foot = new THREE.Object3D();
    foot.name = `mixamorig${suffix}Foot`;
    foot.position.y = -0.46;
    leg.add(foot);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.26), shoes);
    shoe.position.set(0, -0.01, 0.06);
    shoe.castShadow = true;
    foot.add(shoe);
  }
  return group;
}

interface Placement {
  ball: THREE.Vector3;
  yaw: number;
}

/**
 * Golfer character: a humanoid rig (procedural mannequin until the authored GLB loads) whose swings are baked per
 * club from a kinematic model — body turn, IK'd arms on the grip, club head through the ball at impact.
 */
export class Golfer {
  readonly group = new THREE.Group();
  private root: THREE.Object3D;
  private rig: SwingRig;
  private mixer: THREE.AnimationMixer;
  private readonly clubPivot = new THREE.Object3D();
  private club: THREE.Group | undefined;
  private clubDef: ClubDef | undefined;
  private placement: Placement | undefined;
  private pending: { resolve: () => void; impactAt: number; elapsed: number; fired: boolean } | undefined;
  private readonly clips = new Map<string, THREE.AnimationClip>();
  private readonly authored = new Map<string, THREE.AnimationClip>();

  constructor(renderer?: THREE.WebGLRenderer, private readonly environment?: Environment) {
    this.clubPivot.name = 'ClubPivot';
    this.root = proceduralGolfer();
    this.root.add(this.clubPivot);
    this.group.add(this.root);
    this.rig = new SwingRig(this.root);
    this.mixer = new THREE.AnimationMixer(this.root);
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) object.castShadow = true;
    });
    CLUB_MATERIALS.forEach((material) => this.environment?.setupMaterial(material));
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    if (renderer) loader.setKTX2Loader(new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer));
    void loader
      .loadAsync(GOLFER_MODEL)
      .then((asset) => this.adoptModel(asset.scene, asset.animations))
      .catch(() => undefined);
  }

  /** Replaces the mannequin with an authored GLB on a Mixamo-named skeleton; authored clips win by name. */
  private adoptModel(scene: THREE.Group, animations: THREE.AnimationClip[]): void {
    this.mixer.stopAllAction();
    this.group.remove(this.root);
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        object.frustumCulled = false;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (material instanceof THREE.MeshStandardMaterial) {
            material.envMapIntensity = 0.7;
            if (material.map) material.map.anisotropy = 8;
          }
          this.environment?.setupMaterial(material);
        }
      }
    });
    animations.forEach((clip) => this.authored.set(clip.name, clip));
    this.root = scene;
    this.root.add(this.clubPivot);
    this.group.add(scene);
    this.rig = new SwingRig(scene);
    this.mixer = new THREE.AnimationMixer(scene);
    this.clips.clear();
    if (this.clubDef) this.rebake(this.clubDef);
    if (this.placement) this.faceAim(this.placement.ball, this.placement.yaw);
    this.returnToAddress();
  }

  setClub(club: ClubDef): void {
    if (this.clubDef?.id === club.id && this.club) return;
    const categoryChanged = this.clubDef?.category !== club.category;
    if (this.club) this.clubPivot.remove(this.club);
    this.clubDef = club;
    this.club = createClubModel(club);
    this.clubPivot.add(this.club);
    if (categoryChanged) {
      this.rebake(club);
      if (this.placement) this.faceAim(this.placement.ball, this.placement.yaw);
      this.returnToAddress();
    }
  }

  private rebake(club: ClubDef): void {
    const spec = clubSpec(club);
    const ball = new THREE.Vector3(spec.ballForward, BALL_RADIUS, stanceDistance(spec));
    const context = { rig: this.rig, clubPivot: this.clubPivot, spec, ball };
    for (const clip of this.clips.values()) this.mixer.uncacheClip(clip);
    this.clips.clear();
    const names: ClipName[] = ['swing_full', 'swing_chip', 'putt', 'celebrate'];
    for (const name of names) {
      const authored = this.authored.get(name);
      if (authored) {
        this.clips.set(name, authored);
      } else {
        this.clips.set(name, name === 'celebrate' ? bakeCelebration(context) : bakeSwing(context, name));
      }
    }
  }

  /** Moves to the next lie and resets the pose to address. */
  placeForBall(position: { x: number; y: number; z: number }, yaw: number): void {
    this.faceAim(position, yaw);
    this.returnToAddress();
  }

  private returnToAddress(): void {
    const clip = this.clips.get('swing_full');
    if (!clip) return;
    const address = this.mixer.clipAction(clip);
    this.mixer.stopAllAction();
    address.reset().play().paused = true;
    this.mixer.update(0);
  }

  /** Right-handed address: golfer stands perpendicular to the target line, ball off the lead heel. */
  faceAim(ball: { x: number; y: number; z: number }, yaw: number): void {
    this.placement = { ball: new THREE.Vector3(ball.x, ball.y, ball.z), yaw };
    const spec = this.clubDef ? clubSpec(this.clubDef) : specForCategory('driver');
    const stance = stanceDistance(spec);
    const forward = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    this.group.position
      .set(ball.x, ball.y - BALL_RADIUS, ball.z)
      .addScaledVector(right, -stance)
      .addScaledVector(forward, -spec.ballForward);
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
    action.reset().setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
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
