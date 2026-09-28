import * as THREE from 'three';
import type { ClubSpec } from './ClubModels.js';
import { SwingRig } from './SwingRig.js';

export type SwingType = 'swing_full' | 'swing_chip' | 'putt';
export type ClipName = SwingType | 'celebrate';

/** Normalised time within each clip at which the club face meets the ball. Physics launches here, never from the animation. */
export const IMPACT_TIME: Record<SwingType, number> = { swing_full: 0.62, swing_chip: 0.6, putt: 0.55 };
export const CLIP_DURATION: Record<ClipName, number> = { swing_full: 1.4, swing_chip: 1.1, putt: 1.0, celebrate: 1.4 };
const AMPLITUDE: Record<SwingType, number> = { swing_full: 1, swing_chip: 0.45, putt: 0.16 };
const FRAMES_PER_SECOND = 40;

/** Distance from the body centre to the ball for a club, along the character's +Z. */
export function stanceDistance(spec: ClubSpec): number {
  return spec.length * Math.cos(spec.lie) + 0.24;
}

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

const smooth = (u: number): number => {
  const t = THREE.MathUtils.clamp(u, 0, 1);
  return t * t * (3 - 2 * t);
};
const easeIn = (u: number, power: number): number => Math.pow(THREE.MathUtils.clamp(u, 0, 1), power);
const easeOut = (u: number, power: number): number => 1 - Math.pow(1 - THREE.MathUtils.clamp(u, 0, 1), power);

interface Side {
  name: 'Left' | 'Right';
  sign: number;
  pole: THREE.Vector3;
}

const SIDES: Side[] = [
  { name: 'Left', sign: 1, pole: new THREE.Vector3(0.35, -1, -0.35).normalize() },
  { name: 'Right', sign: -1, pole: new THREE.Vector3(-0.35, -1, -0.35).normalize() },
];

interface BodyPose {
  hipsYaw: number;
  hipsTilt: number;
  hipsShift: THREE.Vector3;
  spineYaw: number;
  spineTilt: number;
  spineBend: number;
  kneeFlex: number;
  stanceWidth: number;
  leadLegStraighten: number;
  trailKneeIn: number;
  /** Trail heel coming off the turf as weight posts onto the lead side (0 = flat, 1 = up on the toe). */
  trailHeelLift: number;
  /** Lead knee kicking in toward the ball during the backswing; trail knee stays braced. */
  leadKneeIn: number;
}

interface AddressFrame {
  butt: THREE.Vector3;
  shaft: THREE.Vector3;
  clubX: THREE.Vector3;
  clubQuaternion: THREE.Quaternion;
  pivot: THREE.Vector3;
  normal: THREE.Vector3;
  tilt: number;
}

interface Swing {
  /** In-plane arm rotation, negative on the backswing. */
  phi: (t: number) => number;
  topTime: number;
  impactTime: number;
  phiTop: number;
  phiEnd: number;
  hinge: number;
  amplitude: number;
}

function poseBody(rig: SwingRig, pose: BodyPose): void {
  rig.offsetPosition('Hips', pose.hipsShift);
  rig.applyDeltaEuler('Hips', pose.hipsTilt, pose.hipsYaw, 0);
  const spineBones = ['Spine', 'Spine1', 'Spine2'].filter((name) => rig.bone(name));
  const share = spineBones.length > 0 ? 1 / spineBones.length : 0;
  for (const name of spineBones) {
    rig.applyDeltaEuler(name, pose.spineTilt * share, pose.spineYaw * share, pose.spineBend * share);
  }
  const thigh = -pose.kneeFlex * 0.55;
  const shin = pose.kneeFlex;
  for (const side of SIDES) {
    const lead = side.name === 'Left';
    const straighten = lead ? pose.leadLegStraighten : 0;
    const kneeIn = lead ? pose.leadKneeIn : pose.trailKneeIn;
    const thighAngle = thigh * (1 - straighten) - kneeIn * 0.2 + (lead ? 0 : pose.trailHeelLift * 0.25);
    const shinAngle = shin * (1 - straighten) + kneeIn * 0.8 + (lead ? 0 : pose.trailHeelLift * 0.55);
    const width = pose.stanceWidth * side.sign;
    const roll = kneeIn * 0.35 * (lead ? -1 : 1);
    rig.applyDeltaEuler(`${side.name}UpLeg`, thighAngle, 0, width + roll);
    rig.applyDeltaEuler(`${side.name}Leg`, shinAngle, 0, 0);
    // Feet stay flat on the turf except the trail heel, which peels up in the follow-through.
    const heel = lead ? 0 : pose.trailHeelLift * 0.9;
    rig.applyDeltaEuler(`${side.name}Foot`, -(thighAngle + shinAngle) - pose.hipsTilt + heel, 0, -width - roll);
  }
  rig.update();
}

interface ArmSolution {
  forearmAxis: THREE.Vector3;
}

/** Two-bone analytic IK on shoulder → elbow → wrist, then twists the forearm and orients the hand for the grip. */
function solveArm(rig: SwingRig, side: Side, wrist: THREE.Vector3, palmNormal: THREE.Vector3): ArmSolution | undefined {
  const upper = rig.bone(`${side.name}Arm`);
  const fore = rig.bone(`${side.name}ForeArm`);
  const hand = rig.bone(`${side.name}Hand`);
  if (!upper || !fore || !hand) return undefined;
  const clavicle = rig.bone(`${side.name}Shoulder`);
  const shoulder = rig.positionOf(upper);
  if (clavicle) {
    const raise = THREE.MathUtils.clamp((wrist.y - shoulder.y) / 0.6, 0, 1) * 0.3;
    const forward = THREE.MathUtils.clamp((wrist.z - shoulder.z) / 0.6, -0.5, 1) * 0.12;
    rig.applyDelta(clavicle, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -forward * side.sign, raise * side.sign)));
    rig.update();
    rig.positionOf(upper, shoulder);
  }
  const l1 = rig.restLength(`${side.name}Arm`, `${side.name}ForeArm`);
  const l2 = rig.restLength(`${side.name}ForeArm`, `${side.name}Hand`);
  const toWrist = wrist.clone().sub(shoulder);
  const distance = THREE.MathUtils.clamp(toWrist.length(), Math.abs(l1 - l2) + 0.01, (l1 + l2) * 0.995);
  const u = toWrist.normalize();
  const pole = side.pole.clone().addScaledVector(u, -side.pole.dot(u));
  if (pole.lengthSq() < 1e-4) pole.set(0, 0, -1).addScaledVector(u, u.z);
  pole.normalize();
  const cosA = THREE.MathUtils.clamp((l1 * l1 + distance * distance - l2 * l2) / (2 * l1 * distance), -1, 1);
  const angle = Math.acos(cosA);
  const elbow = shoulder.clone().addScaledVector(u, l1 * Math.cos(angle)).addScaledVector(pole, l1 * Math.sin(angle));

  const currentUpper = rig.axisOf(upper, fore);
  rig.rotate(upper, new THREE.Quaternion().setFromUnitVectors(currentUpper, elbow.clone().sub(shoulder).normalize()));
  rig.update();
  const elbowNow = rig.positionOf(fore);
  const currentFore = rig.axisOf(fore, hand);
  const forearmAxis = wrist.clone().sub(elbowNow).normalize();
  rig.rotate(fore, new THREE.Quaternion().setFromUnitVectors(currentFore, forearmAxis));
  rig.update();
  // Twist the forearm so its palm side already faces the grip, keeping the wrist hinge within reason.
  const restHand = rig.handFrame(side.name);
  const foreDelta = rig.quaternionOf(fore).multiply(rig.restWorld(fore).clone().invert());
  const foreZ = restHand.palm.clone().applyQuaternion(foreDelta);
  foreZ.addScaledVector(forearmAxis, -foreZ.dot(forearmAxis)).normalize();
  const palmInPlane = palmNormal.clone().addScaledVector(forearmAxis, -palmNormal.dot(forearmAxis)).normalize();
  const twist = Math.atan2(foreZ.clone().cross(palmInPlane).dot(forearmAxis), foreZ.dot(palmInPlane));
  rig.rotate(fore, new THREE.Quaternion().setFromAxisAngle(forearmAxis, twist));
  rig.update();

  const palm = palmNormal.clone().normalize();
  const fingers = forearmAxis.clone().addScaledVector(palm, -forearmAxis.dot(palm)).normalize();
  const across = fingers.clone().cross(palm).normalize();
  const target = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, fingers, palm));
  const restBasis = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(restHand.across, restHand.fingers, restHand.palm),
  );
  rig.setOrientation(hand, target.multiply(restBasis.invert()).multiply(rig.restWorld(hand)));
  rig.update();
  return { forearmAxis };
}

/** Curls the fingers toward the palm about the rest knuckle axis, expressed in each phalanx's own frame. */
function curlFingers(rig: SwingRig, side: Side, amount: number): void {
  const { across } = rig.handFrame(side.name);
  const curl = (name: string, angle: number): void => {
    const bone = rig.bone(name);
    if (bone) rig.applyLocal(name, rig.localAxis(bone, across), angle);
  };
  for (const finger of ['Index', 'Middle', 'Ring', 'Pinky']) {
    for (const segment of [1, 2, 3]) {
      curl(`${side.name}Hand${finger}${segment}`, amount * (segment === 1 ? 0.9 : 1));
    }
  }
  for (const segment of [1, 2, 3]) {
    curl(`${side.name}HandThumb${segment}`, amount * 0.25);
  }
}

function lookAt(rig: SwingRig, target: THREE.Vector3, weight: number): void {
  const head = rig.bone('Head');
  const neck = rig.bone('Neck');
  if (!head) return;
  const headPosition = rig.positionOf(head);
  const forward = target.clone().sub(headPosition).normalize();
  const right = new THREE.Vector3().crossVectors(Y, forward).normalize();
  const up = new THREE.Vector3().crossVectors(forward, right).normalize();
  const look = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, forward));
  if (neck) {
    const partial = new THREE.Quaternion().slerp(look, 0.35 * weight);
    rig.setOrientation(neck, partial.multiply(rig.restWorld(neck)));
    rig.update();
  }
  const full = new THREE.Quaternion().slerp(look, weight);
  rig.setOrientation(head, full.multiply(rig.restWorld(head)));
  rig.update();
}

function addressBody(spec: ClubSpec, tilt: number): BodyPose {
  const wide = spec.lie < THREE.MathUtils.degToRad(60);
  return {
    hipsYaw: 0,
    hipsTilt: 0.12,
    hipsShift: new THREE.Vector3(0, -0.035, -0.03),
    spineYaw: 0,
    spineTilt: tilt,
    spineBend: 0.08,
    kneeFlex: 0.42,
    stanceWidth: wide ? 0.13 : 0.08,
    leadLegStraighten: 0,
    trailKneeIn: 0,
    trailHeelLift: 0,
    leadKneeIn: 0,
  };
}

/**
 * Finds the address: shaft resting behind the ball at the club's lie, hands on the grip, torso tilted just enough for
 * the arms to hang to the grip with a little slack.
 */
function solveAddress(rig: SwingRig, spec: ClubSpec, ball: THREE.Vector3): AddressFrame {
  const lean = spec.lie > THREE.MathUtils.degToRad(66) ? 0 : spec.lie > THREE.MathUtils.degToRad(60) ? 0.1 : 0.05;
  const shaft = new THREE.Vector3(-lean, -Math.sin(spec.lie), Math.cos(spec.lie)).normalize();
  const soleContact = new THREE.Vector3(ball.x - 0.02, 0.008, ball.z - 0.045);
  const butt = soleContact.clone().addScaledVector(shaft, -spec.length);
  const clubX = X.clone().addScaledVector(shaft, -X.dot(shaft)).normalize();
  const clubY = shaft.clone().negate();
  const clubZ = new THREE.Vector3().crossVectors(clubX, clubY).normalize();
  const clubQuaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(clubX, clubY, clubZ));

  let tilt = 0.32;
  let pivot = new THREE.Vector3();
  for (let attempt = 0; attempt < 16; attempt += 1) {
    rig.reset();
    poseBody(rig, addressBody(spec, tilt));
    let worst = 0;
    const shoulders: THREE.Vector3[] = [];
    for (const side of SIDES) {
      const upper = rig.bone(`${side.name}Arm`);
      if (!upper) continue;
      const shoulder = rig.positionOf(upper);
      shoulders.push(shoulder);
      const along = side.name === 'Left' ? 0.09 : 0.17;
      const wrist = butt.clone().addScaledVector(shaft, along).addScaledVector(clubX, 0.035 * side.sign);
      const reach = rig.restLength(`${side.name}Arm`, `${side.name}ForeArm`) + rig.restLength(`${side.name}ForeArm`, `${side.name}Hand`);
      worst = Math.max(worst, reach > 0 ? wrist.distanceTo(shoulder) / reach : 0);
    }
    pivot = shoulders.length === 2 ? shoulders[0]!.clone().add(shoulders[1]!).multiplyScalar(0.5) : new THREE.Vector3(0, 1.4, 0);
    if (worst <= 0.9 || tilt >= 0.95) break;
    tilt += 0.045;
  }
  const toBall = ball.clone().sub(pivot).normalize();
  const normal = new THREE.Vector3().crossVectors(toBall, X).normalize();
  return { butt, shaft, clubX, clubQuaternion, pivot, normal, tilt };
}

function buildSwing(type: SwingType): Swing {
  const amplitude = AMPLITUDE[type];
  const impactTime = IMPACT_TIME[type];
  // Tour tempo is roughly 3:1 backswing to downswing; the short game keeps a steadier, more even rhythm.
  const topTime = impactTime * (type === 'swing_full' ? 0.72 : 0.64);
  const phiTop = -2.85 * amplitude;
  const phiEnd = 2.55 * amplitude;
  const hinge = 1.75 * Math.pow(amplitude, 1.2);
  const phi = (t: number): number => {
    if (t < topTime) {
      // Slow, gathering takeaway with a brief settle at the top before transition.
      return phiTop * smooth(easeOut(t / topTime, 1.25));
    }
    if (t < impactTime) return phiTop * (1 - easeIn((t - topTime) / (impactTime - topTime), 2.4));
    // The club keeps accelerating past the ball, then decelerates into a held finish.
    return phiEnd * easeOut((t - impactTime) / (1 - impactTime), 2.9);
  };
  return { phi, topTime, impactTime, phiTop, phiEnd, hinge, amplitude };
}

/**
 * Kinematic sequence: shoulders lead the hips going back, hips lead coming down, weight bumps toward the target
 * before rotation, the lead leg posts up through impact and the trail heel peels off into the finish.
 */
function swingBody(spec: ClubSpec, address: AddressFrame, swing: Swing, t: number): BodyPose {
  const phi = swing.phi(t);
  const downswing = smooth((t - swing.topTime) / 0.08);
  const hipPhi = swing.phi(THREE.MathUtils.clamp(t + THREE.MathUtils.lerp(-0.03, 0.05, downswing), 0, 1));
  const back = phi < 0 ? -phi / -swing.phiTop : 0;
  const through = phi > 0 ? phi / swing.phiEnd : 0;
  const body = addressBody(spec, address.tilt);
  const amp = swing.amplitude;
  // Lateral weight bump: trail side loading going back, then a hip slide toward the target that precedes the turn.
  const shift = -0.035 * back + 0.05 * downswing * (1 - through) + 0.1 * through;
  // Transition squat then post-up: sit slightly as the downswing starts, extend through the ball.
  const squat = downswing * (1 - smooth((t - swing.impactTime + 0.05) / 0.12));
  const post = smooth((t - swing.impactTime + 0.04) / 0.14);
  body.hipsYaw = hipPhi < 0 ? 0.3 * hipPhi : 0.52 * hipPhi;
  body.spineYaw = (phi < 0 ? 0.55 * phi : 0.6 * phi) - body.hipsYaw;
  body.spineTilt = address.tilt * (1 - 0.55 * through) - 0.12 * through;
  body.spineBend = 0.08 + 0.12 * back - 0.25 * through;
  body.hipsShift = new THREE.Vector3(
    shift * amp,
    -0.035 + 0.012 * back - 0.03 * squat + 0.03 * post,
    -0.03 + 0.02 * through - 0.01 * back,
  );
  body.leadLegStraighten = 0.85 * post * amp;
  body.trailKneeIn = 0.55 * through;
  body.trailHeelLift = through * through * amp;
  body.leadKneeIn = 0.45 * back * amp;
  body.kneeFlex = 0.42 + 0.06 * back + 0.14 * squat * amp;
  return body;
}

interface ClubFrame {
  butt: THREE.Vector3;
  shaft: THREE.Vector3;
  clubX: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

function clubFrame(address: AddressFrame, swing: Swing, t: number): ClubFrame {
  const phi = swing.phi(t);
  const fraction = phi < 0 ? -phi / -swing.phiTop : phi / swing.phiEnd;
  // Wrists set progressively going back, then hold the lag through the downswing and release late into impact.
  const lagging = t > swing.topTime && phi < 0;
  const hinge =
    phi < 0
      ? -swing.hinge * Math.pow(fraction, lagging ? 0.55 : 1.4)
      : swing.hinge * Math.pow(fraction, 1.3) * 0.9;
  const armRotation = new THREE.Quaternion().setFromAxisAngle(address.normal, phi);
  const clubRotation = new THREE.Quaternion().setFromAxisAngle(address.normal, phi + hinge);
  const radiusScale = phi < 0 ? 1 - 0.1 * fraction * fraction : 1 - 0.05 * fraction * fraction;
  const butt = address.butt.clone().sub(address.pivot).multiplyScalar(radiusScale).applyQuaternion(armRotation).add(address.pivot);
  return {
    butt,
    shaft: address.shaft.clone().applyQuaternion(clubRotation),
    clubX: address.clubX.clone().applyQuaternion(clubRotation),
    quaternion: clubRotation.clone().multiply(address.clubQuaternion),
  };
}

function placeHands(rig: SwingRig, frame: ClubFrame): void {
  for (const side of SIDES) {
    const along = side.name === 'Left' ? 0.09 : 0.17;
    const wrist = frame.butt.clone().addScaledVector(frame.shaft, along).addScaledVector(frame.clubX, 0.035 * side.sign);
    const palm = frame.clubX.clone().multiplyScalar(-side.sign);
    solveArm(rig, side, wrist, palm);
    curlFingers(rig, side, 1.15);
  }
  rig.update();
}

class Recorder {
  private readonly times: number[] = [];
  private readonly quaternions = new Map<THREE.Object3D, number[]>();
  private readonly positions = new Map<THREE.Object3D, number[]>();

  constructor(private readonly rig: SwingRig, private readonly extra: THREE.Object3D[]) {}

  capture(time: number): void {
    this.times.push(time);
    for (const bone of this.rig.bones.values()) {
      this.push(this.quaternions, bone, bone.quaternion.toArray());
      if (bone === this.rig.bone('Hips')) this.push(this.positions, bone, bone.position.toArray());
    }
    for (const object of this.extra) {
      this.push(this.quaternions, object, object.quaternion.toArray());
      this.push(this.positions, object, object.position.toArray());
    }
  }

  private push(store: Map<THREE.Object3D, number[]>, object: THREE.Object3D, values: number[]): void {
    const list = store.get(object) ?? [];
    list.push(...values);
    store.set(object, list);
  }

  toClip(name: string, duration: number): THREE.AnimationClip {
    const tracks: THREE.KeyframeTrack[] = [];
    for (const [object, values] of this.quaternions) {
      tracks.push(new THREE.QuaternionKeyframeTrack(`${object.name}.quaternion`, this.times, values));
    }
    for (const [object, values] of this.positions) {
      tracks.push(new THREE.VectorKeyframeTrack(`${object.name}.position`, this.times, values));
    }
    return new THREE.AnimationClip(name, duration, tracks);
  }
}

export interface BakeContext {
  rig: SwingRig;
  clubPivot: THREE.Object3D;
  spec: ClubSpec;
  /** Ball position in character space. */
  ball: THREE.Vector3;
}

/** Bakes a swing for this rig, club and lie: body turn, IK'd arms on the grip, club through the ball at impact. */
export function bakeSwing(context: BakeContext, type: SwingType): THREE.AnimationClip {
  const { rig, clubPivot, spec, ball } = context;
  const duration = CLIP_DURATION[type];
  const address = solveAddress(rig, spec, ball);
  const swing = buildSwing(type);
  const recorder = new Recorder(rig, [clubPivot]);
  const frames = Math.round(duration * FRAMES_PER_SECOND);
  for (let index = 0; index <= frames; index += 1) {
    const t = index / frames;
    rig.reset();
    poseBody(rig, swingBody(spec, address, swing, t));
    const frame = clubFrame(address, swing, t);
    placeHands(rig, frame);
    const release = smooth((t - swing.impactTime - 0.06) / 0.3);
    const gaze = ball.clone().add(new THREE.Vector3(30 * release, 6 * release, 5 * release));
    lookAt(rig, gaze, 0.6);
    clubPivot.position.copy(frame.butt);
    clubPivot.quaternion.copy(frame.quaternion);
    recorder.capture(t * duration);
  }
  rig.reset();
  return recorder.toClip(type, duration);
}

/** Both arms up, chest open, then back to address; the club rides along in the trail hand. */
export function bakeCelebration(context: BakeContext): THREE.AnimationClip {
  const { rig, clubPivot, spec, ball } = context;
  const duration = CLIP_DURATION.celebrate;
  const address = solveAddress(rig, spec, ball);
  const recorder = new Recorder(rig, [clubPivot]);
  const frames = Math.round(duration * FRAMES_PER_SECOND);
  for (let index = 0; index <= frames; index += 1) {
    const t = index / frames;
    const raise = t < 0.3 ? smooth(t / 0.3) : t < 0.7 ? 1 : 1 - smooth((t - 0.7) / 0.3);
    rig.reset();
    const body = addressBody(spec, address.tilt);
    body.spineTilt = address.tilt * (1 - raise) - 0.2 * raise;
    body.kneeFlex = 0.42 * (1 - raise) + 0.1 * raise;
    body.hipsShift = new THREE.Vector3(0, -0.035 * (1 - raise), -0.03);
    poseBody(rig, body);
    const addressClub = clubFrame(address, buildSwing('putt'), 0);
    for (const side of SIDES) {
      const upper = rig.bone(`${side.name}Arm`);
      if (!upper) continue;
      const shoulder = rig.positionOf(upper);
      const along = side.name === 'Left' ? 0.09 : 0.17;
      const gripWrist = addressClub.butt.clone().addScaledVector(addressClub.shaft, along).addScaledVector(addressClub.clubX, 0.035 * side.sign);
      const upWrist = shoulder.clone().add(new THREE.Vector3(0.25 * side.sign, 0.5, 0.18));
      const wrist = gripWrist.lerp(upWrist, raise);
      const palm = addressClub.clubX.clone().multiplyScalar(-side.sign).lerp(Z, raise).normalize();
      solveArm(rig, side, wrist, palm);
      curlFingers(rig, side, 1.15 * (1 - raise) + 0.4 * raise);
    }
    rig.update();
    const rightHand = rig.bone('RightHand');
    if (rightHand && raise > 0) {
      const wrist = rig.positionOf(rightHand);
      const shaft = new THREE.Vector3(-0.15, 1, 0.1).normalize();
      const lifted = new THREE.Quaternion().setFromUnitVectors(addressClub.shaft, shaft).multiply(addressClub.quaternion);
      const liftedX = X.clone().applyQuaternion(lifted);
      clubPivot.position.copy(wrist).addScaledVector(liftedX, 0.035).addScaledVector(shaft, -0.17).lerp(addressClub.butt, 1 - raise);
      clubPivot.quaternion.copy(addressClub.quaternion).slerp(lifted, raise);
    } else {
      clubPivot.position.copy(addressClub.butt);
      clubPivot.quaternion.copy(addressClub.quaternion);
    }
    lookAt(rig, new THREE.Vector3(30, 8, 0), 0.6 - raise * 0.25);
    recorder.capture(t * duration);
  }
  rig.reset();
  return recorder.toClip('celebrate', duration);
}
