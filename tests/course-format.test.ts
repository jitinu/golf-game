import { describe, expect, it } from 'vitest';
import { Heightfield, SurfaceMask, parseCourse, SurfaceId, type CourseManifest } from '@golf/course-format';

describe('course format', () => {
  it('interpolates heights, normals, and nearest surfaces', () => {
    const hf = new Heightfield(new Float32Array([0, 1, 1, 2]), 2, 2, 1, { x: 0, z: 0 });
    expect(hf.heightAt(0.5, 0.5)).toBeCloseTo(1);
    expect(hf.normalAt(0.5, 0.5).y).toBeGreaterThan(0);
    const mask = new SurfaceMask(new Uint8Array([SurfaceId.Green, SurfaceId.Rough, SurfaceId.Fairway, SurfaceId.Water]), 2, 2, 1, { x: 0, z: 0 });
    expect(mask.surfaceAt(0, 0)).toBe(SurfaceId.Green);
    expect(mask.surfaceAt(1, 1)).toBe(SurfaceId.Water);
  });

  it('round-trips a manifest and binary buffers', () => {
    const manifest: CourseManifest = {
      courseId: 'test',
      courseVersion: 1,
      physicsVersion: 1,
      name: 'Test',
      heightfield: { width: 2, depth: 2, cellSize: 1, origin: { x: 0, z: 0 }, minHeight: 0, maxHeight: 2, file: 'terrain.height.f32' },
      surfaceMask: { file: 'surface.u8', width: 2, depth: 2, cellSize: 1, origin: { x: 0, z: 0 } },
      holes: [{ number: 1, par: 3, tees: [{ id: 'back', position: { x: 0, y: 0, z: 0 } }], cup: { x: 1, y: 0, z: 1 }, greenCenter: { x: 1, y: 0, z: 1 } }],
      features: { fairways: [], greens: [], bunkers: [], water: [], outOfBounds: [], trees: [] },
    };
    const loaded = parseCourse(manifest, new Float32Array([0, 1, 1, 2]).buffer, new Uint8Array([0, 1, 2, 5]).buffer);
    expect(loaded.cupFor(1).position.y).toBe(2);
    expect(loaded.sampler.surfaceAt(1, 1)).toBe(SurfaceId.Water);
  });
});
