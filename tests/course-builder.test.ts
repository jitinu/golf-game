import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SurfaceId } from '@golf/sim';

describe('Pinecrest course output', () => {
  it('contains generated binaries and playable surfaces', () => {
    const root = new URL('../apps/web/public/courses/pinecrest/', import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL('course.json', root), 'utf8')) as { surfaceMask: { width: number; depth: number } };
    const surface = readFileSync(new URL('surface.u8', root));
    expect(existsSync(new URL('terrain.height.f32', root))).toBe(true);
    expect(surface.length).toBe(manifest.surfaceMask.width * manifest.surfaceMask.depth);
    expect(surface.includes(SurfaceId.Fairway)).toBe(true);
    expect(surface.includes(SurfaceId.Green)).toBe(true);
  });
});
