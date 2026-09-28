import * as THREE from 'three';
import type { ClubSpec } from './ClubModels.js';
import { SwingRig } from './SwingRig.js';

export type SwingType = 'swing_full' | 'swing_chip' | 'putt';
export type ClipName = SwingType | 'celebrate';

/** Normalised time within each clip at which the club face meets the ball. Physics launches here, never from the animation. */
export const IMPACT_TIME: Record<SwingType, number> = { swing_full: 0.62, swing_chip: 0.6, putt: 0.55 };
export const CLIP_DURATION: Record<ClipName, number> = { swing_full: 1.4, swing_chip: 1.1, putt: 1.0, celebrate: 1.4 };
const AMPLITUDE: Record<SwingType, number> = { swing_full: 1, swing_chip: 0.45, putt: 0.16 };
const FRAMES_PER_SECOND = 60;
/** Club speed at impact relative to the downswing's average; keeps the Hermite downswing monotonic (must stay ≤ 3). */
const IMPACT_SPEED_RATIO = 2.6;

/** Where the grip butt sits along the target line at address: just inside the lead thigh. */
const HANDS_X = 0.05;
/** Where each hand's knuckle line crosses the shaft, down the grip from the butt (overlap grip: trail hand below). */
const GRIP_ALONG: Record<Side['name'], number> = { Left: 0.05, Right: 0.13 };

function gripPoint(butt: THREE.Vector3, shaft: THREE.Vector3, side: Side): THREE.Vector3 {
  return butt.clone().addScaledVector(shaft, GRIP_ALONG[side.name]);
}

/** Distance from the body centre to the ball for a club, along the character's +Z. */
export function stanceDistance(spec: ClubSpec): number {
  return spec.length * Math.cos(spec.lie) + 0.22;
}

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

const smooth = (u: number): number => {
  const t = THREE.MathUtils.clamp(u, 0, 1);
  return t * t * (3 - 2 * t);
};
const easeOut = (u: number, power: number): number => 1 - Math.pow(1 - THREE.MathUtils.clamp(u, 0, 1), power);

interface Side {
  name: 'Left' | 'Right';
  sign: number;
  pole: THREE.Vector3;
}

const SIDES: Side[] = [
  { name: 'Left', sign: 1, pole: new THREE.Vector3(0.35, -1, -0.35).normalize() },
  { name: 'Right', sign: -1, pole: new THREE.Vector3(-0.1, -1, -0.3).normalize() },
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

/** Where each foot is planted at address: ankle position and sole orientation in character space. */
interface PlantedFoot {
  ankle: THREE.Vector3;
  orientation: THREE.Quaternion;
}
type PlantedFeet = Record<Side['name'], PlantedFoot>;

interface AddressFrame {
  butt: THREE.Vector3;
  shaft: THREE.Vector3;
  clubX: THREE.Vector3;
  clubQuaternion: THREE.Quaternion;
  pivot: THREE.Vector3;
  normal: THREE.Vector3;
  tilt: number;
  feet: PlantedFeet | undefined;
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

function poseBody(rig: SwingRig, pose: BodyPose, feet?: PlantedFeet): void {
  rig.offsetPosition('Hips', pose.hipsShift);
  // The torso turns about its own tilted axis (yaw first, then the forward tilt), so the shoulders stay centred over
  // the spine instead of swinging around a vertical axis through the hips.
  const hips = rig.bone('Hips');
  if (hips) {
    const torsoTilt = pose.hipsTilt + pose.spineTilt;
    const spineAxis = new THREE.Vector3(0, Math.cos(torsoTilt), Math.sin(torsoTilt));
    const delta = new THREE.Quaternion()
      .setFromAxisAngle(spineAxis, pose.hipsYaw)
      .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(pose.hipsTilt, 0, 0)));
    rig.applyDelta(hips, delta);
  }
  const spineBones = ['Spine', 'Spine1', 'Spine2'].filter((name) => rig.bone(name));
  const share = spineBones.length > 0 ? 1 / spineBones.length : 0;
  for (const name of spineBones) {
    const bone = rig.bone(name);
    if (!bone) continue;
    rig.applyDelta(
      bone,
      new THREE.Quaternion().setFromEuler(new THREE.Euler(pose.spineTilt * share, pose.spineYaw * share, pose.spineBend * share, 'XYZ')),
    );
  }
  if (feet) {
    rig.update();
    for (const side of SIDES) plantFoot(rig, side, feet[side.name], pose);
    rig.update();
    return;
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

/** Foot length used to swing the ankle about the toe when the heel lifts. */
const FOOT_LENGTH = 0.2;

/**
 * Two-bone leg IK: keeps the ankle where it was planted at address while the hips shift, sit and rise, so the feet
 * never slide. Knees point toward the ball, kicking inward with the swing; the trail foot pivots about its toe as the
 * heel peels off in the follow-through.
 */
function plantFoot(rig: SwingRig, side: Side, planted: PlantedFoot, pose: BodyPose): void {
  const upper = rig.bone(`${side.name}UpLeg`);
  const lower = rig.bone(`${side.name}Leg`);
  const foot = rig.bone(`${side.name}Foot`);
  if (!upper || !lower || !foot) return;
  const lead = side.name === 'Left';
  const heel = lead ? 0 : 0.7 * pose.trailHeelLift;
  const target = planted.ankle
    .clone()
    .add(new THREE.Vector3(0, FOOT_LENGTH * Math.sin(heel), FOOT_LENGTH * (1 - Math.cos(heel))));
  const kneeIn = lead ? pose.leadKneeIn : pose.trailKneeIn;
  const hip = rig.positionOf(upper);
  const l1 = rig.restLength(`${side.name}UpLeg`, `${side.name}Leg`);
  const l2 = rig.restLength(`${side.name}Leg`, `${side.name}Foot`);
  const toAnkle = target.clone().sub(hip);
  const distance = THREE.MathUtils.clamp(toAnkle.length(), Math.abs(l1 - l2) + 0.01, (l1 + l2) * 0.995);
  const u = toAnkle.normalize();
  const pole = Z.clone().addScaledVector(X, -side.sign * 0.6 * kneeIn);
  pole.addScaledVector(u, -pole.dot(u));
  if (pole.lengthSq() < 1e-4) pole.set(0, 0, 1).addScaledVector(u, -u.z);
  pole.normalize();
  const cosA = THREE.MathUtils.clamp((l1 * l1 + distance * distance - l2 * l2) / (2 * l1 * distance), -1, 1);
  const angle = Math.acos(cosA);
  const knee = hip.clone().addScaledVector(u, l1 * Math.cos(angle)).addScaledVector(pole, l1 * Math.sin(angle));
  rig.rotate(upper, new THREE.Quaternion().setFromUnitVectors(rig.axisOf(upper, lower), knee.clone().sub(hip).normalize()));
  rig.update();
  const kneeNow = rig.positionOf(lower);
  rig.rotate(lower, new THREE.Quaternion().setFromUnitVectors(rig.axisOf(lower, foot), target.clone().sub(kneeNow).normalize()));
  rig.update();
  const lift = new THREE.Quaternion().setFromAxisAngle(X, heel);
  rig.setOrientation(foot, lift.multiply(planted.orientation));
}

interface ArmSolution {
  forearmAxis: THREE.Vector3;
  /** Character-space direction from the wrist toward the knuckles. */
  fingers: THREE.Vector3;
}

/** The shaft lies across the base of the fingers, this fraction of the way from the wrist to the middle knuckle. */
const PALM_LENGTH_RATIO = 0.82;
/** Palm thickness between the shaft axis and the palm surface. */
const PALM_DEPTH = 0.022;

/**
 * Places a hand on the grip: solves once to learn where the fingers will point, then backs the wrist off along the palm
 * so the knuckles straddle the shaft, and wraps the fingers around it.
 */
function gripHand(
  rig: SwingRig,
  side: Side,
  gripPoint: THREE.Vector3,
  palm: THREE.Vector3,
  shaft: THREE.Vector3,
  curl: number,
  hold = 1,
): void {
  const surface = gripPoint.clone().addScaledVector(palm, -PALM_DEPTH * hold);
  const first = solveArm(rig, side, surface, palm, shaft);
  if (first && hold > 0) {
    const fingers = first.fingers.clone().addScaledVector(shaft, -first.fingers.dot(shaft)).normalize();
    const palmLength = PALM_LENGTH_RATIO * rig.restLength(`${side.name}Hand`, `${side.name}HandMiddle1`);
    solveArm(rig, side, surface.clone().addScaledVector(fingers, -palmLength * hold), palm, shaft);
  }
  curlFingers(rig, side, curl, shaft, palm);
}

/** Two-bone analytic IK on shoulder → elbow → wrist, then twists the forearm and orients the hand for the grip. */
function solveArm(
  rig: SwingRig,
  side: Side,
  wrist: THREE.Vector3,
  palmNormal: THREE.Vector3,
  shaft: THREE.Vector3,
): ArmSolution | undefined {
  const upper = rig.bone(`${side.name}Arm`);
  const fore = rig.bone(`${side.name}ForeArm`);
  const hand = rig.bone(`${side.name}Hand`);
  if (!upper || !fore || !hand) return undefined;
  const clavicle = rig.bone(`${side.name}Shoulder`);
  const shoulder = rig.positionOf(upper);
  const l1 = rig.restLength(`${side.name}Arm`, `${side.name}ForeArm`);
  const l2 = rig.restLength(`${side.name}ForeArm`, `${side.name}Hand`);
  if (clavicle) {
    const raise = THREE.MathUtils.clamp((wrist.y - shoulder.y) / 0.6, 0, 1) * 0.14;
    const forward = THREE.MathUtils.clamp((wrist.z - shoulder.z) / 0.6, -0.5, 1) * 0.1;
    rig.applyDelta(clavicle, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -forward * side.sign, raise * side.sign)));
    rig.update();
    rig.positionOf(upper, shoulder);
    // Shoulder protraction: when the grip is at the limit of the arm's reach the shoulder girdle rolls toward it.
    const stretch = THREE.MathUtils.clamp((wrist.distanceTo(shoulder) / (l1 + l2) - 0.88) / 0.1, 0, 1);
    if (stretch > 0) {
      const socket = rig.positionOf(clavicle);
      const current = shoulder.clone().sub(socket).normalize();
      const wanted = wrist.clone().sub(socket).normalize();
      const full = new THREE.Quaternion().setFromUnitVectors(current, wanted);
      rig.rotate(clavicle, new THREE.Quaternion().slerp(full, 0.45 * stretch));
      rig.update();
      rig.positionOf(upper, shoulder);
    }
  }
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
  const alongForearm = forearmAxis.clone().addScaledVector(palm, -forearmAxis.dot(palm)).normalize();
  const wrap = new THREE.Vector3().crossVectors(shaft, palm);
  wrap.addScaledVector(palm, -wrap.dot(palm));
  const fingers = alongForearm.clone();
  if (wrap.lengthSq() >= 1e-6) {
    wrap.normalize();
    if (wrap.dot(alongForearm) < 0) wrap.negate();
    const MAX_WRIST = 1.1;
    const deviation = Math.acos(THREE.MathUtils.clamp(alongForearm.dot(wrap), -1, 1));
    if (deviation > 1e-4) {
      const sign = Math.sign(new THREE.Vector3().crossVectors(alongForearm, wrap).dot(palm)) || 1;
      fingers.applyQuaternion(
        new THREE.Quaternion().setFromAxisAngle(palm, sign * Math.min(deviation, MAX_WRIST)),
      );
    }
  }
  const across = fingers.clone().cross(palm).normalize();
  const target = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, fingers, palm));
  const restBasis = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(restHand.across, restHand.fingers, restHand.palm),
  );
  rig.setOrientation(hand, target.multiply(restBasis.invert()).multiply(rig.restWorld(hand)));
  rig.update();
  return { forearmAxis, fingers };
}

/** Wraps the fingers around the shaft: each phalanx curls about the shaft axis, toward the palm. */
function curlFingers(rig: SwingRig, side: Side, amount: number, shaft: THREE.Vector3, palmNormal: THREE.Vector3): void {
  const hand = rig.bone(`${side.name}Hand`);
  if (!hand) return;
  hand.updateWorldMatrix(true, false);
  const restHand = rig.handFrame(side.name);
  const handDelta = rig.quaternionOf(hand).multiply(rig.restWorld(hand).clone().invert());
  const fingersNow = restHand.fingers.clone().applyQuaternion(handDelta);
  const sign = Math.sign(new THREE.Vector3().crossVectors(shaft, fingersNow).dot(palmNormal)) || 1;
  const axis = new THREE.Vector3();
  const curl = (name: string, angle: number): void => {
    const bone = rig.bone(name);
    if (!bone) return;
    bone.updateWorldMatrix(true, false);
    axis.copy(shaft).applyQuaternion(rig.quaternionOf(bone).invert()).normalize();
    rig.applyLocal(name, axis, sign * angle);
    bone.updateWorldMatrix(false, false);
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
  // Hands sit just inside the lead thigh regardless of ball position, so the shaft leans toward the target for the
  // short clubs (ball centred) and away from it for the driver (ball off the lead heel).
  const soleContact = new THREE.Vector3(ball.x - 0.02, 0.008, ball.z - 0.045);
  const lean = (HANDS_X - soleContact.x) / spec.length;
  const shaft = new THREE.Vector3(-lean, -Math.sin(spec.lie), Math.cos(spec.lie)).normalize();
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
      const wrist = gripPoint(butt, shaft, side);
      const reach = rig.restLength(`${side.name}Arm`, `${side.name}ForeArm`) + rig.restLength(`${side.name}ForeArm`, `${side.name}Hand`);
      worst = Math.max(worst, reach > 0 ? wrist.distanceTo(shoulder) / reach : 0);
    }
    pivot = shoulders.length === 2 ? shoulders[0]!.clone().add(shoulders[1]!).multiplyScalar(0.5) : new THREE.Vector3(0, 1.4, 0);
    if (worst <= 0.93 || tilt >= 0.9) break;
    tilt += 0.045;
  }
  const toBall = ball.clone().sub(pivot).normalize();
  const normal = new THREE.Vector3().crossVectors(toBall, X).normalize();
  const feet = plantedFeet(rig);
  return { butt, shaft, clubX, clubQuaternion, pivot, normal, tilt, feet };
}

/** Records where the address pose put each ankle and how the sole sits, for the leg IK to hold through the swing. */
function plantedFeet(rig: SwingRig): PlantedFeet | undefined {
  const record = (side: Side): PlantedFoot | undefined => {
    const foot = rig.bone(`${side.name}Foot`);
    if (!foot || !rig.bone(`${side.name}UpLeg`) || !rig.bone(`${side.name}Leg`)) return undefined;
    return { ankle: rig.positionOf(foot), orientation: rig.quaternionOf(foot) };
  };
  const left = record(SIDES[0]!);
  const right = record(SIDES[1]!);
  return left && right ? { Left: left, Right: right } : undefined;
}

function buildSwing(type: SwingType): Swing {
  const amplitude = AMPLITUDE[type];
  const impactTime = IMPACT_TIME[type];
  // Tour tempo is roughly 3:1 backswing to downswing; the short game keeps a steadier, more even rhythm.
  const topTime = impactTime * (type === 'swing_full' ? 0.72 : 0.64);
  const phiTop = -2.7 * amplitude;
  const phiEnd = (type === 'swing_full' ? 1.9 : 2.0) * amplitude;
  const hinge = 1.85 * Math.pow(amplitude, 1.2);
  // One C1-continuous arc: the downswing is a Hermite segment leaving the top at rest and arriving at impact at
  // IMPACT_SPEED_RATIO × its average speed; the follow-through carries exactly that speed and decays
  // exponentially into a held finish, so nothing hitches at the top or at the ball.
  const downswing = impactTime - topTime;
  const impactVelocity = (IMPACT_SPEED_RATIO * -phiTop) / downswing;
  const decay = (impactVelocity * (1 - impactTime)) / phiEnd;
  const settle = 1 - Math.exp(-decay);
  const phi = (t: number): number => {
    if (t < topTime) {
      // Slow, gathering takeaway with a brief settle at the top before transition.
      return phiTop * smooth(easeOut(t / topTime, 1.25));
    }
    if (t < impactTime) {
      const s = (t - topTime) / downswing;
      const h01 = s * s * (3 - 2 * s);
      const h11 = s * s * (s - 1);
      return phiTop * (1 - h01) + IMPACT_SPEED_RATIO * -phiTop * h11;
    }
    const s = (t - impactTime) / (1 - impactTime);
    return (phiEnd * (1 - Math.exp(-decay * s))) / settle;
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
  body.spineYaw = (phi < 0 ? 0.5 * phi : 0.6 * phi) - body.hipsYaw;
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
  // Wrists set progressively going back, hold the lag through the downswing and release late into impact; the
  // release continues at the same rate past the ball and re-hinges into the finish.
  const lagging = t > swing.topTime && phi < 0;
  const held = 1 - Math.pow(1 - fraction, 2.5);
  const hinge = phi < 0 ? -swing.hinge * (lagging ? held : Math.pow(fraction, 1.4)) : swing.hinge * held * 0.9;
  const armRotation = new THREE.Quaternion().setFromAxisAngle(address.normal, phi);
  const clubRotation = new THREE.Quaternion().setFromAxisAngle(address.normal, phi + hinge);
  const radiusScale = phi < 0 ? 1 + 0.08 * fraction * fraction : 1 - 0.1 * fraction * fraction;
  // At address the hands hang below the shoulder plane; going back they rise toward it (hands beside the trail
  // shoulder at the top, not over the head) and in the finish they fold behind the head, below the plane.
  const armVector = address.butt.clone().sub(address.pivot);
  const offPlane = armVector.dot(address.normal);
  const lift = phi < 0 ? 1 : 1 + 0.18 * Math.pow(fraction, 1.2);
  const inPlane = armVector.clone().addScaledVector(address.normal, -offPlane).multiplyScalar(radiusScale).applyQuaternion(armRotation);
  const butt = inPlane.addScaledVector(address.normal, offPlane * lift).add(address.pivot);
  // The hands ride up over the trail shoulder at the top and over the lead shoulder in the finish, keeping the
  // folded arm at a right angle rather than collapsing onto the shoulder.
  butt.y += phi < 0 ? 0.11 * Math.pow(fraction, 1.5) : 0.08 * Math.pow(fraction, 2);
  return {
    butt,
    shaft: address.shaft.clone().applyQuaternion(clubRotation),
    clubX: address.clubX.clone().applyQuaternion(clubRotation),
    quaternion: clubRotation.clone().multiply(address.clubQuaternion),
  };
}

/**
 * Pulls the club toward the body when a grip point sits beyond an arm's reach, so a straight lead arm at the top (or
 * trail arm in the finish) still keeps its hand on the grip instead of falling short of it.
 */
function clampToReach(rig: SwingRig, frame: ClubFrame): void {
  const shift = new THREE.Vector3();
  for (const side of SIDES) {
    const upper = rig.bone(`${side.name}Arm`);
    if (!upper) continue;
    const shoulder = rig.positionOf(upper);
    const reach =
      0.97 * (rig.restLength(`${side.name}Arm`, `${side.name}ForeArm`) + rig.restLength(`${side.name}ForeArm`, `${side.name}Hand`)) +
      PALM_LENGTH_RATIO * rig.restLength(`${side.name}Hand`, `${side.name}HandMiddle1`);
    const toGrip = gripPoint(frame.butt, frame.shaft, side).add(shift).sub(shoulder);
    const excess = toGrip.length() - reach;
    if (excess > 0) shift.addScaledVector(toGrip.normalize(), -excess);
  }
  frame.butt.add(shift);
}

function placeHands(rig: SwingRig, frame: ClubFrame): void {
  clampToReach(rig, frame);
  for (const side of SIDES) {
    const palm = frame.clubX.clone().multiplyScalar(-side.sign);
    gripHand(rig, side, gripPoint(frame.butt, frame.shaft, side), palm, frame.shaft, 1.15);
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
    poseBody(rig, swingBody(spec, address, swing, t), address.feet);
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
      const upWrist = shoulder.clone().add(new THREE.Vector3(0.25 * side.sign, 0.5, 0.18));
      const grip = gripPoint(addressClub.butt, addressClub.shaft, side).lerp(upWrist, raise);
      const palm = addressClub.clubX.clone().multiplyScalar(-side.sign).lerp(Z, raise).normalize();
      gripHand(rig, side, grip, palm, addressClub.shaft, 1.15 * (1 - raise) + 0.4 * raise, 1 - raise);
    }
    rig.update();
    const rightHand = rig.bone('RightHand');
    if (rightHand && raise > 0) {
      const wrist = rig.positionOf(rightHand);
      const shaft = new THREE.Vector3(-0.15, 1, 0.1).normalize();
      const lifted = new THREE.Quaternion().setFromUnitVectors(addressClub.shaft, shaft).multiply(addressClub.quaternion);
      const liftedX = X.clone().applyQuaternion(lifted);
      clubPivot.position.copy(wrist).addScaledVector(liftedX, PALM_DEPTH).addScaledVector(shaft, -GRIP_ALONG.Right).lerp(addressClub.butt, 1 - raise);
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
