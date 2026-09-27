import { describe, expect, it } from 'vitest';
import { validatePlayerName } from '@golf/protocol';

describe('player names', () => {
  it('normalizes and strips unsafe formatting characters', () => {
    expect(validatePlayerName('  Ａlice\u200b  ')).toEqual({ ok: true, name: 'Alice' });
    expect(validatePlayerName('\u0000\u200b')).toEqual({ ok: false, reason: 'Name is required' });
    expect(validatePlayerName('a'.repeat(21)).ok).toBe(false);
  });
});
