import * as THREE from 'three';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SurfaceId, type LoadedCourse } from '@golf/course-format';
import type { GraphicsPreset } from '../app/GraphicsPreset.js';

const NORMAL_SIZE = 256;

/** Tileable ripple normal map from layered sine waves, so the reflection distorts like gently moving water. */
function rippleNormals(): THREE.DataTexture {
  const data = new Uint8Array(NORMAL_SIZE * NORMAL_SIZE * 4);
  const waves = [
    { dx: 1, dz: 0.3, k: 6, amp: 0.7 },
    { dx: -0.4, dz: 1, k: 9, amp: 0.5 },
    { dx: 0.7, dz: -0.6, k: 15, amp: 0.3 },
    { dx: -0.9, dz: -0.2, k: 23, amp: 0.2 },
  ];
  const heightAt = (u: number, v: number) => waves.reduce((sum, wave) => sum + wave.amp * Math.sin((u * wave.dx + v * wave.dz) * wave.k * Math.PI * 2), 0);
  const step = 1 / NORMAL_SIZE;
  for (let y = 0; y < NORMAL_SIZE; y += 1) {
    for (let x = 0; x < NORMAL_SIZE; x += 1) {
      const u = x / NORMAL_SIZE;
      const v = y / NORMAL_SIZE;
      const dx = (heightAt(u + step, v) - heightAt(u - step, v)) * 3;
      const dz = (heightAt(u, v + step) - heightAt(u, v - step)) * 3;
      const length = Math.hypot(dx, dz, 1);
      const index = (y * NORMAL_SIZE + x) * 4;
      data[index] = Math.round((-dx / length * 0.5 + 0.5) * 255);
      data[index + 1] = Math.round((-dz / length * 0.5 + 0.5) * 255);
      data[index + 2] = Math.round((1 / length * 0.5 + 0.5) * 255);
      data[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, NORMAL_SIZE, NORMAL_SIZE, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export class WaterSurface {
  readonly group = new THREE.Group();

  constructor(course: LoadedCourse, preset: GraphicsPreset, sunDirection: THREE.Vector3 = new THREE.Vector3(0.4, 0.8, 0.3)) {
    const normals = rippleNormals();
    // Every Water mesh renders its own reflection pass, so bodies sharing a level are merged into one plane.
    const byLevel = new Map<number, THREE.BufferGeometry[]>();
    for (const polygon of course.manifest.features.water) {
      const level = polygon.waterLevel ?? Math.min(...polygon.points.map((point) => course.sampler.heightAt(point.x, point.z))) - 0.2;
      const key = Math.round(level * 100) / 100;
      // Shape lies in XY; rotating -90° about X maps shape Y to world -Z, so author it negated.
      const shape = new THREE.Shape(polygon.points.map((point) => new THREE.Vector2(point.x, -point.z)));
      byLevel.set(key, [...(byLevel.get(key) ?? []), new THREE.ShapeGeometry(shape)]);
    }
    for (const [level, geometries] of byLevel) {
      const geometry = geometries.length === 1 ? geometries[0]! : mergeGeometries(geometries);
      if (geometries.length > 1) geometries.forEach((source) => source.dispose());
      if (!geometry) continue;
      const water = new Water(geometry, {
        textureWidth: preset.waterRes,
        textureHeight: preset.waterRes,
        waterNormals: normals,
        sunDirection: sunDirection.clone().normalize(),
        sunColor: 0xfff1dc,
        waterColor: 0x2f7078,
        distortionScale: 0.9,
        alpha: 0.96,
      });
      // The stock shader treats water like a mirror (F0 = 0.3); real water is ~0.02, so reflections
      // only take over at grazing angles and the body reads as water rather than a white sheet.
      water.material.fragmentShader = water.material.fragmentShader
        .replace('float rf0 = 0.3;', 'float rf0 = 0.04;')
        .replace('vec3( 0.1 ) + reflectionSample * 0.9 + reflectionSample * specularLight', 'reflectionSample * 0.55 + reflectionSample * specularLight');
      water.material.needsUpdate = true;
      water.rotation.x = -Math.PI / 2;
      water.position.set(0, level, 0);
      water.userData.surface = SurfaceId.Water;
      water.userData.excludeAO = true;
      this.group.add(water);
    }
  }

  update(time: number): void {
    this.group.traverse((object) => {
      if (object instanceof Water && object.material.uniforms.time) object.material.uniforms.time.value = time * 0.6;
    });
  }
}
