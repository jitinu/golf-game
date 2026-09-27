import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { LoadedCourse } from '@golf/course-format';
import type { Environment } from '../render/Environment.js';

const DETAIL_DISTANCE = 0;
const LOW_POLY_DISTANCE = 30;
const BILLBOARD_DISTANCE = 100;

function hash(value: number): number {
  const x = Math.sin(value * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x4b3020, roughness: 0.95 });

function canopyMaterial(tint: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(0x2c6a33).offsetHSL(0, 0, (tint - 0.5) * 0.12), roughness: 0.95 });
}

/** Procedural conifer: three stacked cones on a trunk. Used until an authored GLB replaces level 0. */
function proceduralTree(scale: number, tint: number, detailed: boolean): THREE.Group {
  const group = new THREE.Group();
  const segments = detailed ? 10 : 6;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.24, 2.6, segments), trunkMaterial);
  trunk.position.y = 1.3;
  trunk.castShadow = true;
  group.add(trunk);
  const canopy = canopyMaterial(tint);
  const tiers = detailed ? 3 : 2;
  for (let tier = 0; tier < tiers; tier += 1) {
    const radius = 1.9 - tier * 0.45;
    const height = 3.2 - tier * 0.4;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(radius, height, segments), canopy);
    cone.position.y = 3.2 + tier * 1.6;
    cone.castShadow = true;
    group.add(cone);
  }
  group.scale.setScalar(scale);
  return group;
}

export class Vegetation {
  readonly group = new THREE.Group();

  constructor(course: LoadedCourse, environment?: Environment, renderer?: THREE.WebGLRenderer) {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    if (renderer) loader.setKTX2Loader(new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer));
    const billboardTexture = this.billboardTexture();
    const modelCache = new Map<string, Promise<THREE.Group>>();
    const billboardGeometry = new THREE.PlaneGeometry(1, 1);

    course.manifest.features.trees.forEach((tree, index) => {
      const tint = hash(index * 7.7);
      const scale = tree.scale * (0.9 + hash(index * 3.3) * 0.2);
      const lod = new THREE.LOD();
      lod.position.set(tree.position.x, course.sampler.heightAt(tree.position.x, tree.position.z), tree.position.z);
      lod.rotation.y = tree.rotation;
      const detail = proceduralTree(scale, tint, true);
      lod.addLevel(detail, DETAIL_DISTANCE);
      lod.addLevel(proceduralTree(scale, tint, false), LOW_POLY_DISTANCE);
      const billboard = new THREE.Mesh(
        billboardGeometry,
        new THREE.MeshBasicMaterial({ map: billboardTexture, alphaTest: 0.5, side: THREE.DoubleSide, color: new THREE.Color(0xffffff).offsetHSL(0, 0, (tint - 0.5) * 0.1) }),
      );
      billboard.scale.set(5 * scale, 8.5 * scale, 1);
      billboard.position.y = 4.2 * scale;
      billboard.userData.excludeAO = true;
      billboard.onBeforeRender = (_renderer, _scene, camera) => {
        billboard.rotation.y = Math.atan2(camera.position.x - lod.position.x, camera.position.z - lod.position.z) - lod.rotation.y;
      };
      lod.addLevel(billboard, BILLBOARD_DISTANCE);
      this.group.add(lod);

      const cached = modelCache.get(tree.kind) ?? loader.loadAsync(`/models/trees/${tree.kind}.glb`).then((asset) => asset.scene);
      modelCache.set(tree.kind, cached);
      void cached
        .then((scene) => {
          const model = scene.clone(true);
          model.scale.setScalar(scale);
          model.traverse((object) => {
            if (object instanceof THREE.Mesh) {
              object.castShadow = true;
              environment?.setupMaterial(object.material);
            }
          });
          detail.clear();
          detail.scale.setScalar(1);
          detail.add(model);
        })
        .catch(() => undefined);
    });

    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) environment?.setupMaterial(object.material);
    });
  }

  private billboardTexture(): THREE.Texture {
    const canvas = this.billboardCanvas();
    const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data ?? new Uint8ClampedArray(canvas.width * canvas.height * 4);
    const texture = new THREE.DataTexture(new Uint8Array(pixels.buffer), canvas.width, canvas.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.flipY = true;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }

  private billboardCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (context) {
      context.clearRect(0, 0, 128, 256);
      context.fillStyle = '#5b3926';
      context.fillRect(58, 200, 12, 56);
      context.fillStyle = '#2c6a33';
      for (let tier = 0; tier < 3; tier += 1) {
        const top = 10 + tier * 60;
        const halfWidth = 34 + tier * 14;
        context.beginPath();
        context.moveTo(64, top);
        context.lineTo(64 - halfWidth, top + 90);
        context.lineTo(64 + halfWidth, top + 90);
        context.closePath();
        context.fill();
      }
    }
    return canvas;
  }
}
