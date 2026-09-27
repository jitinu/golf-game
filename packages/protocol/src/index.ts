import type { ShotCommand, Vec3 } from '@golf/sim';

export type { ShotCommand, Vec3 };

export interface ShotRecord {
  hole: number;
  stroke: number;
  command: ShotCommand;
  from: Vec3;
  to: Vec3;
  result: 'flight' | 'holed' | 'water' | 'oob';
}

export interface RunTicket {
  runId: string;
  token: string;
  expiresAt: string;
}

export interface StartRunRequest {
  courseId: string;
  courseVersion: number;
  clientVersion: string;
}

export interface FinishRunRequest {
  playerName: string;
  holeStrokes: number[];
  shots: ShotRecord[];
  durationMs: number;
  turnstileToken?: string;
}

export interface FinishRunResponse {
  scoreId: string;
  totalStrokes: number;
  toPar: number;
  rank: number | null;
}

export interface LeaderboardEntry {
  rank: number;
  playerName: string;
  totalStrokes: number;
  toPar: number;
  createdAt: string;
}

export interface LeaderboardResponse {
  courseId: string;
  entries: LeaderboardEntry[];
  plays: number;
}

export interface CourseStats {
  courseId: string;
  plays: number;
  bestScore: number | null;
  averageScore: number | null;
}

export const PLAYER_NAME_MIN = 1;
export const PLAYER_NAME_MAX = 20;
export const PROTOCOL_VERSION = 1;

export function validatePlayerName(raw: string): { ok: true; name: string } | { ok: false; reason: string } {
  // eslint-disable-next-line no-control-regex
  const normalized = raw.normalize('NFKC').trim().replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200d\u2060\ufeff]/g, '');
  if (normalized.length < PLAYER_NAME_MIN) return { ok: false, reason: 'Name is required' };
  if (normalized.length > PLAYER_NAME_MAX) return { ok: false, reason: 'Name must be 20 characters or fewer' };
  return { ok: true, name: normalized };
}
