import * as THREE from 'three';
import type { LoadedCourse } from '@golf/course-format';

export class CourseDebugView {
  readonly group = new THREE.Group();
  private readonly label = document.createElement('div');
  constructor(course: LoadedCourse) {
    this.label.style.cssText = 'position:fixed;right:20px;bottom:20px;padding:10px;background:#101d24dd;border-radius:8px;font:12px monospace;display:none';
    document.body.append(this.label);
    const material = new THREE.MeshBasicMaterial({ color: 0x66bb6a, transparent: true, opacity: 0.22, side: THREE.DoubleSide });
    const geometry = new THREE.PlaneGeometry(course.heightfield.width * course.heightfield.cellSize, course.heightfield.depth * course.heightfield.cellSize);
    const mask = new THREE.Mesh(geometry, material);
    mask.rotation.x = -Math.PI / 2;
    mask.position.set(course.heightfield.origin.x, 0.05, course.heightfield.origin.z);
    this.group.add(mask);
  }
  setVisible(visible: boolean): void { this.group.visible = visible; this.label.style.display = visible ? 'block' : 'none'; }
  updateReadout(course: LoadedCourse, point: THREE.Vector3): void {
    this.label.textContent = `surface ${course.sampler.surfaceAt(point.x, point.z)}\nheight ${course.sampler.heightAt(point.x, point.z).toFixed(2)}\nnormal ${JSON.stringify(course.sampler.normalAt(point.x, point.z))}`;
  }
}
