import * as THREE from 'three';
import type { Cup } from '@golf/sim';

export function createCupAndFlag(cup: Cup, color = 0xf5f1db): THREE.Group {
  const group = new THREE.Group();
  group.position.set(cup.position.x, cup.position.y, cup.position.z);
  const hole = new THREE.Mesh(new THREE.CylinderGeometry(cup.radius, cup.radius, 0.03, 24), new THREE.MeshStandardMaterial({ color: 0x171717, roughness: 1 }));
  hole.position.y = 0.006;
  group.add(hole);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 3.2, 8), new THREE.MeshStandardMaterial({ color: 0xe8e6dc, roughness: 0.8 }));
  pole.position.y = 1.6;
  pole.castShadow = true;
  group.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.45, 4, 1), new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.8 }));
  flag.position.set(0.35, 2.75, 0);
  flag.rotation.y = Math.PI / 2;
  flag.castShadow = true;
  group.add(flag);
  return group;
}
