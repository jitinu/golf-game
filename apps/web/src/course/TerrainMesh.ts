import * as THREE from 'three';
import type { LoadedCourse } from '@golf/course-format';
import type { Environment } from '../render/Environment.js';

function createMaskTexture(course: LoadedCourse): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array(course.surfaceMask.data).buffer, course.surfaceMask.width, course.surfaceMask.depth, THREE.RedFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
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
      positions.setY(index, hf.data[sourceZ * hf.width + sourceX] ?? 0);
      positions.setX(index, (sourceX * hf.cellSize) + hf.origin.x - ((hf.width - 1) * hf.cellSize) / 2);
      positions.setZ(index, (sourceZ * hf.cellSize) + hf.origin.z - ((hf.depth - 1) * hf.cellSize) / 2);
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
    const material = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.surfaceMask = { value: this.maskTexture };
      shader.fragmentShader = shader.fragmentShader
        .replace('uniform vec3 diffuse;', 'uniform vec3 diffuse; uniform sampler2D surfaceMask;')
        .replace('#include <color_fragment>', '#include <color_fragment>\nfloat surfaceValue = texture2D(surfaceMask, vMapUv).r * 255.0;\nvec3 surfaceTint = vec3(0.33,0.48,0.20);\nif (surfaceValue < 0.5) surfaceTint = vec3(0.18,0.42,0.16); else if (surfaceValue > 3.5 && surfaceValue < 4.5) surfaceTint = vec3(0.76,0.68,0.48); else if (surfaceValue > 5.5 && surfaceValue < 7.5) surfaceTint = vec3(0.50,0.48,0.44);\ndiffuseColor.rgb *= surfaceTint;');
    };
    this.mesh = new THREE.Mesh(createTerrainGeometry(course), material);
    this.mesh.receiveShadow = true;
    environment?.setupMaterial(material);
  }
}
