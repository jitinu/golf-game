import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { LoadedCourse } from '@golf/course-format';

function lowPolyTree(scale: number): THREE.Group {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 2.4, 7), new THREE.MeshStandardMaterial({ color: 0x4b3020 }));
  trunk.position.y = 1.2;
  trunk.castShadow = true;
  group.add(trunk);
  const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.4, 3.8, 8), new THREE.MeshStandardMaterial({ color: 0x285b2e, roughness: 0.95 }));
  canopy.position.y = 3.4;
  canopy.castShadow = true;
  group.add(canopy);
  group.scale.setScalar(scale);
  return group;
}

export class Vegetation {
  readonly group = new THREE.Group();

  constructor(course: LoadedCourse) {
    const loader = new GLTFLoader();
    course.manifest.features.trees.forEach((tree) => {
      const lod = new THREE.LOD();
      const detail = lowPolyTree(tree.scale);
      detail.rotation.y = tree.rotation;
      detail.position.copy(tree.position);
      lod.addLevel(detail, 0);
      const mid = lowPolyTree(tree.scale * 0.86);
      lod.addLevel(mid, 30);
      const billboard = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x39703d }));
      billboard.scale.set(10 * tree.scale, 14 * tree.scale, 1);
      lod.addLevel(billboard, 100);
      this.group.add(lod);
      void loader.loadAsync(`/models/trees/${tree.kind}.glb`).then((asset) => {
        const model = asset.scene;
        model.scale.setScalar(tree.scale);
        model.rotation.y = tree.rotation;
        model.position.copy(tree.position);
        model.traverse((object) => {
          if (object instanceof THREE.Mesh) object.castShadow = true;
        });
        lod.levels[0]?.object.clear();
        lod.levels[0]?.object.add(model);
      }).catch(() => undefined);
    });
  }
}
