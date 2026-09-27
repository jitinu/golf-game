import * as THREE from 'three';
import { SurfaceId, type LoadedCourse } from '@golf/course-format';
import type { GraphicsPreset } from '../app/GraphicsPreset.js';

function hash(value: number): number {
  const x = Math.sin(value * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function bladeGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0,
    0, 0, -0.5, 0, 0, 0.5, 0, 1, 0.5, 0, 1, -0.5,
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1,
  ], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  return geometry;
}

function grassMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, map: { value: null } },
    vertexColors: true,
    side: THREE.DoubleSide,
    transparent: true,
    alphaTest: 0.4,
    depthWrite: true,
    vertexShader: `
      attribute float phase;
      attribute float lean;
      varying vec2 vUv;
      varying vec3 vColor;
      uniform float time;
      void main() {
        vUv = uv;
        vColor = color;
        vec3 p = position;
        float h = clamp(p.y, 0.0, 1.0);
        p.x += lean * h * h + sin(time * 1.5 + phase) * 0.08 * h * h;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vColor;
      void main() {
        float alpha = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.72, vUv.y);
        if (alpha < 0.4) discard;
        gl_FragColor = vec4(vColor, alpha);
      }
    `,
  });
}

export class GrassField {
  readonly group = new THREE.Group();
  private readonly materials: THREE.ShaderMaterial[] = [];

  constructor(course: LoadedCourse, preset: GraphicsPreset) {
    const ringCounts = [Math.floor(preset.grassInstances * 0.5), Math.floor(preset.grassInstances * 0.32), preset.grassInstances - Math.floor(preset.grassInstances * 0.82)];
    ringCounts.forEach((count, ring) => {
      const mesh = new THREE.InstancedMesh(bladeGeometry(), grassMaterial(), count);
      const material = mesh.material as THREE.ShaderMaterial;
      this.materials.push(material);
      const phases = new Float32Array(count);
      const leans = new Float32Array(count);
      const colors = new Float32Array(count * 3);
      const matrix = new THREE.Matrix4();
      const maxRadius = [15, 35, 60][ring] ?? 60;
      for (let index = 0; index < count; index += 1) {
        const angle = hash(index * 5.7 + ring) * Math.PI * 2;
        const radius = Math.sqrt(hash(index * 3.1 + ring * 17)) * maxRadius;
        const x = course.manifest.heightfield.origin.x + (hash(index * 2.3) - 0.5) * 600 + Math.cos(angle) * radius;
        const z = course.manifest.heightfield.origin.z + (hash(index * 4.1) - 0.5) * 900 + Math.sin(angle) * radius;
        const surface = course.surfaceMask.surfaceAt(x, z);
        const enabled = surface !== SurfaceId.Bunker && surface !== SurfaceId.Water && surface !== SurfaceId.Path && surface !== SurfaceId.OutOfBounds;
        const height = enabled ? 0.35 + hash(index * 9.2) * (ring === 2 ? 0.7 : 0.35) : 0;
        matrix.makeScale(0.06 + hash(index * 1.8) * 0.08, height, 0.06 + hash(index * 2.8) * 0.08);
        matrix.setPosition(x, course.sampler.heightAt(x, z) + height * 0.5, z);
        mesh.setMatrixAt(index, matrix);
        phases[index] = hash(index * 8.2) * Math.PI * 2;
        leans[index] = (hash(index * 6.2) - 0.5) * 0.16;
        const tint = 0.75 + hash(index * 7.1) * 0.25;
        colors.set([0.18 * tint, 0.38 * tint, 0.12 * tint], index * 3);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.geometry.setAttribute('phase', new THREE.InstancedBufferAttribute(phases, 1));
      mesh.geometry.setAttribute('lean', new THREE.InstancedBufferAttribute(leans, 1));
      mesh.geometry.setAttribute('color', new THREE.InstancedBufferAttribute(colors, 3));
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    });
  }

  update(time: number): void {
    this.materials.forEach((material) => { if (material.uniforms.time) material.uniforms.time.value = time; });
  }
}
