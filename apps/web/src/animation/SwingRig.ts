import * as THREE from 'three';

/**
 * Character-space helpers over a Mixamo-named humanoid (with or without the `mixamorig` prefix).
 * Character space is the rig root's frame: +Z faces the ball, +X is the target line, Y up.
 */

export function stripPrefix(name: string): string {
  return name.replace(/^mixamorig:?/, '');
}

interface RestPose {
  quaternion: THREE.Quaternion;
  position: THREE.Vector3;
  /** Rest orientation relative to the rig root. */
  world: THREE.Quaternion;
  /** Rest position relative to the rig root. */
  worldPosition: THREE.Vector3;
}

/** Rest-pose hand axes in character space. */
export interface HandFrame {
  fingers: THREE.Vector3;
  palm: THREE.Vector3;
  /** `fingers × palm`: the knuckle line, thumb side positive; fingers curl about it. */
  across: THREE.Vector3;
}

const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpQ3 = new THREE.Quaternion();
const tmpV = new THREE.Vector3();

export class SwingRig {
  readonly bones = new Map<string, THREE.Object3D>();
  private readonly rest = new Map<THREE.Object3D, RestPose>();
  private readonly rootWorldInverse = new THREE.Quaternion();
  private readonly handFrames = new Map<string, HandFrame>();

  constructor(readonly root: THREE.Object3D) {
    root.updateWorldMatrix(true, true);
    root.getWorldQuaternion(this.rootWorldInverse).invert();
    root.traverse((object) => {
      if (object === root || object instanceof THREE.Mesh || !object.name || object.name === 'ClubPivot') return;
      const name = stripPrefix(object.name);
      if (this.bones.has(name)) return;
      this.bones.set(name, object);
      const world = new THREE.Quaternion();
      object.getWorldQuaternion(world).premultiply(this.rootWorldInverse);
      const worldPosition = root.worldToLocal(object.getWorldPosition(new THREE.Vector3()));
      this.rest.set(object, { quaternion: object.quaternion.clone(), position: object.position.clone(), world, worldPosition });
    });
  }

  restPosition(bone: THREE.Object3D, out = new THREE.Vector3()): THREE.Vector3 {
    const rest = this.rest.get(bone);
    return rest ? out.copy(rest.worldPosition) : out.set(0, 0, 0);
  }

  /**
   * Rest hand axes derived from the finger geometry (middle finger direction, index→pinky knuckle line), so rigs with
   * arbitrary bone rolls still grip correctly. Falls back to Mixamo's local convention (+Y fingers, +Z palm).
   */
  handFrame(side: 'Left' | 'Right'): HandFrame {
    const cached = this.handFrames.get(side);
    if (cached) return cached;
    const hand = this.bone(`${side}Hand`);
    const restQ = hand ? this.restWorld(hand) : new THREE.Quaternion();
    const fingers = new THREE.Vector3(0, 1, 0).applyQuaternion(restQ);
    const palm = new THREE.Vector3(0, 0, 1).applyQuaternion(restQ);
    const middle = this.bone(`${side}HandMiddle1`);
    const index = this.bone(`${side}HandIndex1`);
    const pinky = this.bone(`${side}HandPinky1`);
    if (hand && middle && index && pinky) {
      const direction = this.restPosition(middle).sub(this.restPosition(hand, tmpV));
      const knuckles = this.restPosition(index).sub(this.restPosition(pinky, tmpV));
      if (direction.lengthSq() > 1e-8 && knuckles.lengthSq() > 1e-8) {
        fingers.copy(direction).normalize();
        knuckles.addScaledVector(fingers, -knuckles.dot(fingers));
        // Right hand: palm = knuckles × fingers (thumb up, palm inward); mirrored for the left.
        palm.crossVectors(knuckles, fingers).multiplyScalar(side === 'Right' ? 1 : -1).normalize();
      }
    }
    const frame = { fingers, palm, across: fingers.clone().cross(palm).normalize() };
    this.handFrames.set(side, frame);
    return frame;
  }

  /** Character-space rest axis expressed in a bone's local frame (for `applyLocal`). */
  localAxis(bone: THREE.Object3D, axis: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(axis).applyQuaternion(tmpQ.copy(this.restWorld(bone)).invert()).normalize();
  }

  bone(name: string): THREE.Object3D | undefined {
    return this.bones.get(name);
  }

  reset(): void {
    for (const [bone, rest] of this.rest) {
      bone.quaternion.copy(rest.quaternion);
      bone.position.copy(rest.position);
    }
    this.update();
  }

  update(): void {
    this.root.updateWorldMatrix(true, true);
    this.root.getWorldQuaternion(this.rootWorldInverse).invert();
  }

  restWorld(bone: THREE.Object3D): THREE.Quaternion {
    return this.rest.get(bone)?.world ?? new THREE.Quaternion();
  }

  restLength(from: string, to: string): number {
    const child = this.bone(to);
    return child ? this.rest.get(child)?.position.length() ?? 0 : 0;
  }

  positionOf(bone: THREE.Object3D, out = new THREE.Vector3()): THREE.Vector3 {
    bone.getWorldPosition(out);
    return this.root.worldToLocal(out);
  }

  quaternionOf(bone: THREE.Object3D, out = new THREE.Quaternion()): THREE.Quaternion {
    bone.getWorldQuaternion(out).premultiply(this.rootWorldInverse);
    return out;
  }

  /** Sets a bone's orientation in character space. */
  setOrientation(bone: THREE.Object3D, orientation: THREE.Quaternion): void {
    if (bone.parent) {
      this.quaternionOf(bone.parent, tmpQ).invert();
      bone.quaternion.copy(tmpQ).multiply(orientation);
    } else {
      bone.quaternion.copy(orientation);
    }
    bone.updateWorldMatrix(false, true);
  }

  /** Rotates a bone by a character-space rotation on top of its current orientation. */
  rotate(bone: THREE.Object3D, rotation: THREE.Quaternion): void {
    this.quaternionOf(bone, tmpQ2);
    this.setOrientation(bone, tmpQ3.copy(rotation).multiply(tmpQ2));
  }

  /**
   * Applies a character-space rotation relative to the rest pose, composed under the parent's own rotation:
   * `local = restLocal · restWorld⁻¹ · delta · restWorld`, so a spine yaw carries the shoulders with it.
   */
  applyDelta(bone: THREE.Object3D, delta: THREE.Quaternion): void {
    const rest = this.rest.get(bone);
    if (!rest) return;
    bone.quaternion.copy(rest.quaternion).multiply(tmpQ.copy(rest.world).invert()).multiply(delta).multiply(rest.world);
  }

  applyDeltaEuler(name: string, x: number, y: number, z: number): void {
    const bone = this.bone(name);
    if (!bone) return;
    this.applyDelta(bone, tmpQ2.setFromEuler(new THREE.Euler(x, y, z, 'YXZ')));
  }

  /** Rotates a bone about one of its own local axes relative to rest (finger curls). */
  applyLocal(name: string, axis: THREE.Vector3, angle: number): void {
    const bone = this.bone(name);
    const rest = bone ? this.rest.get(bone) : undefined;
    if (!bone || !rest) return;
    bone.quaternion.copy(rest.quaternion).multiply(tmpQ.setFromAxisAngle(axis, angle));
  }

  offsetPosition(name: string, offset: THREE.Vector3): void {
    const bone = this.bone(name);
    const rest = bone ? this.rest.get(bone) : undefined;
    if (!bone || !rest) return;
    bone.position.copy(rest.position).add(offset);
  }

  /** Direction (character space) from a bone to its named child, or its rest +Y if the child is missing. */
  axisOf(bone: THREE.Object3D, child?: THREE.Object3D, out = new THREE.Vector3()): THREE.Vector3 {
    if (child) {
      this.positionOf(child, out).sub(this.positionOf(bone, tmpV));
      if (out.lengthSq() > 1e-8) return out.normalize();
    }
    return out.set(0, 1, 0).applyQuaternion(this.quaternionOf(bone, tmpQ));
  }
}
