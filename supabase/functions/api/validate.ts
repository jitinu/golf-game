export const PLAYER_NAME_MIN = 1;
export const PLAYER_NAME_MAX = 20;

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; reason: string };

// Keep these rules in sync with packages/protocol, the source of truth for API validation.
export function validatePlayerName(raw: string): ValidationResult<string> {
  // eslint-disable-next-line no-control-regex
  const normalized = raw.normalize('NFKC').trim().replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200d\u2060\ufeff]/g, '');
  if (normalized.length < PLAYER_NAME_MIN) return { ok: false, reason: 'Name is required' };
  if (normalized.length > PLAYER_NAME_MAX) return { ok: false, reason: 'Name must be 20 characters or fewer' };
  return { ok: true, value: normalized };
}

export function validateHoleStrokes(strokes: unknown): ValidationResult<number[]> {
  if (!Array.isArray(strokes) || strokes.some((stroke) => !Number.isInteger(stroke) || stroke < 1 || stroke > 20)) {
    return { ok: false, reason: 'Each hole must have between 1 and 20 strokes' };
  }
  return { ok: true, value: strokes };
}
