import * as THREE from 'three';
import type { ClubDef } from '@golf/sim';

const face = new THREE.MeshPhysicalMaterial({ color: 0x9ca5af, roughness: 0.35, metalness: 1 });
const crown = new THREE.MeshPhysicalMaterial({ color: 0x17212c, roughness: 0.2, metalness: 0.8, clearcoat: 1 });
const grip = new THREE.MeshPhysicalMaterial({ color: 0x151515, roughness: 0.9 });

function extrudedHead(shape: THREE.Shape, material: THREE.Material, depth: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 2, bevelSize: 0.012, bevelThickness: 0.012 }), material);
}

export function createClubModel(club: ClubDef): THREE.Group {
  const group = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.016, 1.05, 10), face);
  shaft.position.y = -0.52;
  group.add(shaft);
  const gripMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.034, 0.26, 10), grip);
  gripMesh.position.y = 0.12;
  group.add(gripMesh);
  const shape = new THREE.Shape();
  if (club.category === 'driver') {
    shape.moveTo(-0.12, 0); shape.quadraticCurveTo(0, -0.15, 0.16, 0); shape.quadraticCurveTo(0.2, 0.12, 0.1, 0.22); shape.lineTo(-0.1, 0.22); shape.closePath();
  } else if (club.category === 'wood' || club.category === 'hybrid') {
    shape.moveTo(-0.1, 0); shape.lineTo(0.13, 0); shape.lineTo(0.09, 0.2); shape.lineTo(-0.08, 0.2); shape.closePath();
  } else if (club.category === 'putter') {
    shape.moveTo(-0.16, 0); shape.lineTo(0.16, 0); shape.lineTo(0.13, 0.11); shape.lineTo(-0.13, 0.11); shape.closePath();
  } else {
    shape.moveTo(-0.09, 0); shape.lineTo(0.09, 0); shape.lineTo(0.07, 0.17); shape.lineTo(-0.06, 0.17); shape.closePath();
  }
  const head = extrudedHead(shape, club.category === 'driver' ? crown : face, 0.08);
  head.rotation.x = Math.PI / 2;
  head.position.y = -1.05;
  group.add(head);
  return group;
}
