import * as THREE from 'three';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { SurfaceId, type LoadedCourse } from '@golf/course-format';
import type { GraphicsPreset } from '../app/GraphicsPreset.js';

function normalTexture(): THREE.DataTexture {
  const data = new Uint8Array([128, 190, 255, 128, 190, 255, 128, 190, 255, 128, 190, 255]);
  const texture = new THREE.DataTexture(data, 2, 2, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

export class WaterSurface {
  readonly group = new THREE.Group();

  constructor(course: LoadedCourse, preset: GraphicsPreset) {
    const sun = new THREE.Vector3(0.4, 0.8, 0.3).normalize();
    course.manifest.features.water.forEach((polygon) => {
      const shape = new THREE.Shape(polygon.points.map((point) => new THREE.Vector2(point.x, -point.z)));
      const geometry = new THREE.ShapeGeometry(shape);
      const water = new Water(geometry, {
        textureWidth: preset.waterRes,
        textureHeight: preset.waterRes,
        waterNormals: normalTexture(),
        sunDirection: sun,
        sunColor: 0xffffff,
        waterColor: 0x0b3d4a,
        distortionScale: 1,
        alpha: 0.95,
      });
      water.rotation.x = -Math.PI / 2;
      const center = polygon.points.reduce((acc, point) => ({ x: acc.x + point.x, z: acc.z + point.z }), { x: 0, z: 0 });
      center.x /= polygon.points.length;
      center.z /= polygon.points.length;
      water.position.set(0, course.sampler.heightAt(center.x, center.z) - 0.2, 0);
      water.userData.surface = SurfaceId.Water;
      this.group.add(water);
    });
  }

  update(time: number): void {
    this.group.traverse((object) => {
      if (object instanceof Water && object.material.uniforms.time) object.material.uniforms.time.value = time;
    });
  }
}
