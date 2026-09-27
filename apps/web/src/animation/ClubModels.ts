import * as THREE from 'three';
import type { ClubDef } from '@golf/sim';

/**
 * Club model frame: origin at the butt of the grip, shaft running down −Y, face normal +X (towards the target),
 * toe +Z (away from the golfer). Head geometry is tilted so the sole sits flat when the shaft leans at the club's lie.
 */
export interface ClubSpec {
  /** Butt to sole along the shaft, metres. */
  length: number;
  /** Shaft angle from the ground at address, radians. */
  lie: number;
  /** Ball position relative to the stance centre along the target line, metres (positive = towards the target). */
  ballForward: number;
}

const SPECS: Record<ClubDef['category'], ClubSpec> = {
  driver: { length: 1.14, lie: THREE.MathUtils.degToRad(57), ballForward: 0.16 },
  wood: { length: 1.09, lie: THREE.MathUtils.degToRad(58), ballForward: 0.12 },
  hybrid: { length: 1.03, lie: THREE.MathUtils.degToRad(59.5), ballForward: 0.08 },
  iron: { length: 0.96, lie: THREE.MathUtils.degToRad(62), ballForward: 0.04 },
  wedge: { length: 0.9, lie: THREE.MathUtils.degToRad(64), ballForward: 0 },
  putter: { length: 0.87, lie: THREE.MathUtils.degToRad(71), ballForward: 0.02 },
};

export function specForCategory(category: ClubDef['category']): ClubSpec {
  return SPECS[category] ?? SPECS.iron;
}

export function clubSpec(club: ClubDef): ClubSpec {
  return specForCategory(club.category);
}

const steel = new THREE.MeshPhysicalMaterial({ color: 0xd9dde2, metalness: 1, roughness: 0.28 });
const satin = new THREE.MeshPhysicalMaterial({ color: 0xc4c9cf, metalness: 1, roughness: 0.45 });
const face = new THREE.MeshPhysicalMaterial({ color: 0x8f969e, metalness: 1, roughness: 0.55 });
const crown = new THREE.MeshPhysicalMaterial({ color: 0x0b0f14, metalness: 0.2, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08 });
const carbon = new THREE.MeshPhysicalMaterial({ color: 0x1a1d22, metalness: 0.6, roughness: 0.35, clearcoat: 0.6 });
const rubber = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 });
const gripCap = new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.7 });
const ferruleMaterial = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.4 });

export const CLUB_MATERIALS: THREE.Material[] = [steel, satin, face, crown, carbon, rubber, gripCap, ferruleMaterial];

function shaftAndGrip(length: number, headOffset: number): THREE.Object3D[] {
  const shaftLength = length - headOffset;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0068, shaftLength, 14), steel);
  shaft.position.y = -shaftLength / 2;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0105, 0.27, 16), rubber);
  grip.position.y = -0.135;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.0125, 0.008, 16), gripCap);
  cap.position.y = -0.002;
  const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.0068, 0.0085, 0.018, 12), ferruleMaterial);
  ferrule.position.y = -shaftLength + 0.006;
  return [shaft, grip, cap, ferrule];
}

/** Rounded profile of a wood head viewed from above: heel at the hosel, bulging towards the toe and rear. */
function woodHead(width: number, depth: number, height: number, faceLoft: number, glossy: boolean): THREE.Group {
  const group = new THREE.Group();
  const centre = new THREE.Vector3(-depth * 0.42, height * 0.5, width * 0.3);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 40, 24), glossy ? crown : carbon);
  body.scale.set(depth, height, width);
  body.position.copy(centre);
  group.add(body);
  // Flat striking face just ahead of the body, tilted back by the loft.
  const facePlate = new THREE.Mesh(new THREE.BoxGeometry(0.004, height * 0.9, width * 0.84), face);
  facePlate.position.set(depth * 0.08 + 0.001, height * 0.52, width * 0.3);
  facePlate.rotation.z = faceLoft;
  group.add(facePlate);
  const sole = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 16, 0, Math.PI * 2, Math.PI * 0.64, Math.PI * 0.36), satin);
  sole.scale.set(depth * 1.012, height * 1.012, width * 1.012);
  sole.position.copy(centre);
  group.add(sole);
  const hosel = new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.012, 0.045, 12), satin);
  hosel.position.set(0, 0.035, 0);
  group.add(hosel);
  return group;
}

/** Cavity-back iron: a tapered blade whose height grows towards the toe, with a hosel rising from the heel. */
function ironHead(loft: number, wedge: boolean): THREE.Group {
  const group = new THREE.Group();
  const width = wedge ? 0.088 : 0.082;
  const heelHeight = 0.036;
  const toeHeight = wedge ? 0.058 : 0.052;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(width, 0.004);
  shape.quadraticCurveTo(width + 0.008, toeHeight * 0.6, width - 0.01, toeHeight);
  shape.lineTo(0.02, heelHeight);
  shape.quadraticCurveTo(0.004, heelHeight - 0.004, 0, heelHeight - 0.012);
  shape.closePath();
  const blade = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: 0.011, bevelEnabled: true, bevelSegments: 3, bevelSize: 0.0025, bevelThickness: 0.0025 }),
    satin,
  );
  // Extrude runs along +Z; turn it so width runs heel→toe (+Z), depth goes behind the face (−X), then lean back by the loft.
  blade.rotation.set(0, -Math.PI / 2, loft, 'ZYX');
  blade.position.set(0.0055, 0, 0);
  group.add(blade);
  const facePlate = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.9, heelHeight * 0.9), face);
  facePlate.rotation.set(0, Math.PI / 2, loft, 'ZYX');
  facePlate.position.set(0.0085, heelHeight * 0.55, width * 0.5);
  group.add(facePlate);
  const hosel = new THREE.Mesh(new THREE.CylinderGeometry(0.0072, 0.0095, 0.062, 12), satin);
  hosel.position.set(0, heelHeight * 0.5 + 0.02, 0.006);
  group.add(hosel);
  return group;
}

function putterHead(): THREE.Group {
  const group = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.026, 0.11), satin);
  blade.position.set(-0.012, 0.013, 0.045);
  group.add(blade);
  const flange = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.075), carbon);
  flange.position.set(-0.04, 0.007, 0.045);
  group.add(flange);
  const insert = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.02, 0.095), rubber);
  insert.position.set(0.004, 0.013, 0.045);
  group.add(insert);
  const sightline = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.001, 0.003), gripCap);
  sightline.position.set(-0.04, 0.0135, 0.045);
  group.add(sightline);
  const hosel = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 10), satin);
  hosel.position.set(-0.006, 0.045, 0.012);
  group.add(hosel);
  return group;
}

export function createClubModel(club: ClubDef): THREE.Group {
  const spec = clubSpec(club);
  const group = new THREE.Group();
  const loft = THREE.MathUtils.degToRad(club.loftDeg);
  let head: THREE.Group;
  let headOffset: number;
  if (club.category === 'driver') {
    head = woodHead(0.12, 0.11, 0.062, loft, true);
    headOffset = 0.03;
  } else if (club.category === 'wood') {
    head = woodHead(0.1, 0.085, 0.04, loft, true);
    headOffset = 0.025;
  } else if (club.category === 'hybrid') {
    head = woodHead(0.085, 0.06, 0.036, loft, false);
    headOffset = 0.025;
  } else if (club.category === 'putter') {
    head = putterHead();
    headOffset = 0.05;
  } else {
    head = ironHead(loft, club.category === 'wedge');
    headOffset = 0.04;
  }
  group.add(...shaftAndGrip(spec.length, headOffset));
  // Sole flat on the ground when the shaft leans at the lie angle: tilt the head about the face normal.
  head.rotation.x = Math.PI / 2 - spec.lie;
  head.position.y = -spec.length;
  group.add(head);
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  return group;
}
