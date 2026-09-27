import type {
  CourseStats,
  FinishRunRequest,
  FinishRunResponse,
  LeaderboardEntry,
  LeaderboardResponse,
  RunTicket,
  StartRunRequest,
} from '@golf/protocol';

export interface ScoreService {
  startRun(request: StartRunRequest): Promise<RunTicket | null>;
  finishRun(request: FinishRunRequest, ticket: RunTicket | null): Promise<FinishRunResponse | null>;
  leaderboard(courseId: string): Promise<LeaderboardResponse>;
  stats(courseId: string): Promise<CourseStats>;
}

interface LocalStore {
  plays: number;
  par: number;
  entries: LeaderboardEntry[];
}

const localKey = (courseId: string) => `golf-leaderboard:${courseId}`;

function readStore(courseId: string, par: number): LocalStore {
  try {
    const raw = localStorage.getItem(localKey(courseId));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocalStore>;
      return { plays: parsed.plays ?? 0, par: parsed.par ?? par, entries: parsed.entries ?? [] };
    }
  } catch {
    // corrupt storage falls back to an empty board
  }
  return { plays: 0, par, entries: [] };
}

function writeStore(courseId: string, store: LocalStore): void {
  localStorage.setItem(localKey(courseId), JSON.stringify(store));
}

/** Offline fallback used when VITE_API_URL is not configured. */
export class LocalLeaderboard implements ScoreService {
  private courseId = 'pinecrest';
  private par = 12;

  async startRun(request: StartRunRequest): Promise<RunTicket | null> {
    this.courseId = request.courseId;
    this.par = await this.coursePar(request.courseId);
    return null;
  }

  async finishRun(request: FinishRunRequest): Promise<FinishRunResponse | null> {
    const store = readStore(this.courseId, this.par);
    const totalStrokes = request.holeStrokes.reduce((sum, value) => sum + value, 0);
    const toPar = totalStrokes - store.par;
    const scoreId = crypto.randomUUID();
    store.entries.push({ rank: 0, scoreId, playerName: request.playerName, totalStrokes, toPar, createdAt: new Date().toISOString() });
    store.entries.sort((a, b) => a.totalStrokes - b.totalStrokes || a.createdAt.localeCompare(b.createdAt));
    store.entries = store.entries.slice(0, 100).map((entry, index) => ({ ...entry, rank: index + 1 }));
    store.plays += 1;
    writeStore(this.courseId, store);
    const rank = store.entries.find((entry) => entry.scoreId === scoreId)?.rank ?? null;
    return { scoreId, totalStrokes, toPar, rank };
  }

  async leaderboard(courseId: string): Promise<LeaderboardResponse> {
    const store = readStore(courseId, this.par);
    return { courseId, entries: store.entries, plays: store.plays };
  }

  async stats(courseId: string): Promise<CourseStats> {
    const store = readStore(courseId, this.par);
    const scores = store.entries.map((entry) => entry.totalStrokes);
    return {
      courseId,
      plays: store.plays,
      bestScore: scores[0] ?? null,
      averageScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    };
  }

  private async coursePar(courseId: string): Promise<number> {
    try {
      const index = (await (await fetch('/courses/index.json')).json()) as Array<{ courseId: string; par?: number }>;
      return index.find((course) => course.courseId === courseId)?.par ?? this.par;
    } catch {
      return this.par;
    }
  }
}

export class ApiClient implements ScoreService {
  private readonly baseUrl = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '');
  private readonly local = new LocalLeaderboard();

  get isRemote(): boolean {
    return Boolean(this.baseUrl);
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `API request failed (${response.status})`);
    }
    return response.json() as Promise<T>;
  }

  startRun(request: StartRunRequest): Promise<RunTicket | null> {
    return this.baseUrl ? this.request<RunTicket>('/v1/runs', { method: 'POST', body: JSON.stringify(request) }) : this.local.startRun(request);
  }

  finishRun(request: FinishRunRequest, ticket: RunTicket | null): Promise<FinishRunResponse | null> {
    if (!this.baseUrl) return this.local.finishRun(request);
    if (!ticket) return Promise.reject(new Error('Run ticket missing; refresh and try again'));
    return this.request<FinishRunResponse>(`/v1/runs/${encodeURIComponent(ticket.runId)}/finish`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ticket.token}` },
      body: JSON.stringify(request),
    });
  }

  leaderboard(courseId: string): Promise<LeaderboardResponse> {
    return this.baseUrl ? this.request(`/v1/leaderboard?courseId=${encodeURIComponent(courseId)}`) : this.local.leaderboard(courseId);
  }

  stats(courseId: string): Promise<CourseStats> {
    return this.baseUrl ? this.request(`/v1/stats?courseId=${encodeURIComponent(courseId)}`) : this.local.stats(courseId);
  }
}
