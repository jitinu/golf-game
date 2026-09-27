import { describe, expect, it } from 'vitest';
import { validateHoleStrokes, validatePlayerName } from '../supabase/functions/api/validate';

describe('supabase validation', () => {
  it('mirrors protocol player-name normalization', () => {
    expect(validatePlayerName('  A\u200blice  ')).toEqual({ ok: true, value: 'Alice' });
    expect(validatePlayerName('')).toEqual({ ok: false, reason: 'Name is required' });
    expect(validatePlayerName('123456789012345678901')).toEqual({
      ok: false,
      reason: 'Name must be 20 characters or fewer',
    });
  });

  it('validates one-to-twenty stroke values', () => {
    expect(validateHoleStrokes([4, 3, 5])).toEqual({ ok: true, value: [4, 3, 5] });
    expect(validateHoleStrokes([4, 0])).toEqual({
      ok: false,
      reason: 'Each hole must have between 1 and 20 strokes',
    });
    expect(validateHoleStrokes(['4'])).toEqual({
      ok: false,
      reason: 'Each hole must have between 1 and 20 strokes',
    });
  });
});
