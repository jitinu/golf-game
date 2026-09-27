import * as THREE from 'three';
import { SurfaceId, type LoadedCourse } from '@golf/course-format';

const PALETTE: Record<number, [number, number, number]> = {
  [SurfaceId.Green]: [50, 180, 60], [SurfaceId.Fairway]: [90, 150, 45], [SurfaceId.FirstCut]: [150, 170, 45],
  [SurfaceId.Rough]: [100, 120, 45], [SurfaceId.Bunker]: [220, 190, 110], [SurfaceId.Water]: [40, 130, 210],
  [SurfaceId.Dirt]: [130, 90, 50], [SurfaceId.Path]: [150, 150, 150], [SurfaceId.OutOfBounds]: [220, 40, 40],
};

export class CourseDebugView {
  readonly group = new THREE.Group();
  private readonly label = document.createElement('div');
  constructor(private readonly course: LoadedCourse) {
    this.label.style.cssText = 'position:fixed;right:20px;bottom:20px;padding:10px;background:#101d24dd;color:white;border-radius:8px;font:12px monospace;display:none;white-space:pre';
    document.body.append(this.label);
    const rgba = new Uint8Array(course.surfaceMask.data.length * 4);
    course.surfaceMask.data.forEach((surface, index) => {
      const color = PALETTE[surface] ?? [255, 0, 255];
      rgba.set([color[0] ?? 255, color[1] ?? 0, color[2] ?? 255, 180], index * 4);
    });
    const texture = new THREE.DataTexture(rgba, course.surfaceMask.width, course.surfaceMask.depth, THREE.RGBAFormat);
    texture.needsUpdate = true;
    const mask = new THREE.Mesh(new THREE.PlaneGeometry(course.heightfield.width * course.heightfield.cellSize, course.heightfield.depth * course.heightfield.cellSize), new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.65, side: THREE.DoubleSide }));
    mask.rotation.x = -Math.PI / 2;
    mask.position.set(course.heightfield.origin.x, 0.05, course.heightfield.origin.z);
    this.group.add(mask);
    for (let x = course.heightfield.origin.x; x < course.heightfield.origin.x + course.heightfield.width * course.heightfield.cellSize; x += 10) {
      for (let z = course.heightfield.origin.z; z < course.heightfield.origin.z + course.heightfield.depth * course.heightfield.cellSize; z += 10) {
        const p = new THREE.Vector3(x, course.sampler.heightAt(x, z) + 0.1, z);
        const normal = course.sampler.normalAt(x, z);
        this.group.add(new THREE.ArrowHelper(new THREE.Vector3(normal.x, normal.y, normal.z), p, 2, 0xffff00));
      }
    }
    course.manifest.features.fairways.forEach((spline) => {
      const points = spline.points.map((point) => new THREE.Vector3(point.x, course.sampler.heightAt(point.x, point.z) + 0.08, point.z));
      this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0x00ffff })));
    });
    course.manifest.holes.forEach((hole) => {
      const cup = course.cupFor(hole);
      const ring = new THREE.Mesh(new THREE.RingGeometry(cup.radius * 0.9, cup.radius, 32), new THREE.MeshBasicMaterial({ color: 0xff00ff, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(cup.position.x, cup.position.y + 0.08, cup.position.z);
      this.group.add(ring);
    });
  }
  setVisible(visible: boolean): void {
    this.group.visible = visible;
    this.label.style.display = visible ? 'block' : 'none';
  }

  dispose(): void {
    this.label.remove();
  }
  updateReadout(course: LoadedCourse, point: THREE.Vector3): void {
    const normal = course.sampler.normalAt(point.x, point.z);
    this.label.textContent = `surface ${course.sampler.surfaceAt(point.x, point.z)}\nheight ${course.sampler.heightAt(point.x, point.z).toFixed(2)}\nnormal ${normal.x.toFixed(2)}, ${normal.y.toFixed(2)}, ${normal.z.toFixed(2)}`;
  }
}
