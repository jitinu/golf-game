import * as THREE from 'three';
import type { LoadedCourse } from '@golf/course-format';
import type { Environment } from '../render/Environment.js';
import { createTerrainMaterial } from './TerrainMaterial.js';

export function createMaskTexture(course: LoadedCourse): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array(course.surfaceMask.data), course.surfaceMask.width, course.surfaceMask.depth, THREE.RedFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  // Single-byte rows of arbitrary width need 1-byte row alignment.
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

function createTerrainGeometry(course: LoadedCourse): THREE.BufferGeometry {
  const hf = course.heightfield;
  const stride = Math.max(1, Math.ceil(Math.max(hf.width, hf.depth) / 512));
  const width = Math.ceil((hf.width - 1) / stride) + 1;
  const depth = Math.ceil((hf.depth - 1) / stride) + 1;
  const geometry = new THREE.PlaneGeometry((width - 1) * hf.cellSize * stride, (depth - 1) * hf.cellSize * stride, width - 1, depth - 1);
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  for (let iz = 0; iz < depth; iz += 1) {
    for (let ix = 0; ix < width; ix += 1) {
      const sourceX = Math.min(hf.width - 1, ix * stride);
      const sourceZ = Math.min(hf.depth - 1, iz * stride);
      const index = iz * width + ix;
      positions.setX(index, sourceX * hf.cellSize + hf.origin.x);
      positions.setY(index, -(sourceZ * hf.cellSize + hf.origin.z));
      positions.setZ(index, hf.data[sourceZ * hf.width + sourceX] ?? 0);
    }
  }
  geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

export class TerrainMesh {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  readonly maskTexture: THREE.DataTexture;

  constructor(course: LoadedCourse, environment?: Environment) {
    this.maskTexture = createMaskTexture(course);
    const mask = course.surfaceMask;
    const material = createTerrainMaterial(
      this.maskTexture,
      new THREE.Vector2(mask.origin.x, mask.origin.z),
      new THREE.Vector2(mask.width * mask.cellSize, mask.depth * mask.cellSize),
      environment,
    );
    this.mesh = new THREE.Mesh(createTerrainGeometry(course), material);
    this.mesh.receiveShadow = true;
  }
}
