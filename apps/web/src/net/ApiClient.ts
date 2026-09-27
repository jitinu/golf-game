import type { CourseStats, FinishRunRequest, FinishRunResponse, LeaderboardResponse, RunTicket, StartRunRequest } from '@golf/protocol';

export interface ScoreService {
  startRun(request: StartRunRequest): Promise<RunTicket | null>;
  finishRun(request: FinishRunRequest, ticket: RunTicket | null): Promise<FinishRunResponse | null>;
  leaderboard(courseId: string): Promise<LeaderboardResponse>;
  stats(courseId: string): Promise<CourseStats>;
}

const localKey = (courseId: string) => `golf-leaderboard:${courseId}`;

export class LocalLeaderboard implements ScoreService {
  async startRun(request: StartRunRequest): Promise<RunTicket | null> { void request; return null; }
  async finishRun(request: FinishRunRequest, ticket: RunTicket | null): Promise<FinishRunResponse | null> {
    void ticket;
    const key = localKey(request.shots[0]?.command.clubId ?? 'pinecrest');
    const entries = JSON.parse(localStorage.getItem(key) ?? '[]') as Array<{ playerName: string; totalStrokes: number; toPar: number; createdAt: string }>;
    const totalStrokes = request.holeStrokes.reduce((sum, value) => sum + value, 0);
    entries.push({ playerName: request.playerName, totalStrokes, toPar: totalStrokes - 12, createdAt: new Date().toISOString() });
    entries.sort((a, b) => a.totalStrokes - b.totalStrokes);
    localStorage.setItem(key, JSON.stringify(entries.slice(0, 100)));
    return { scoreId: crypto.randomUUID(), totalStrokes, toPar: totalStrokes - 12, rank: entries.findIndex((entry) => entry.totalStrokes === totalStrokes) + 1 };
  }
  async leaderboard(courseId: string): Promise<LeaderboardResponse> {
    const entries = (JSON.parse(localStorage.getItem(localKey(courseId)) ?? '[]') as Array<{ playerName: string; totalStrokes: number; toPar: number; createdAt: string }>).map((entry, index) => ({ ...entry, rank: index + 1 }));
    return { courseId, entries, plays: entries.length };
  }
  async stats(courseId: string): Promise<CourseStats> {
    const board = await this.leaderboard(courseId);
    const scores = board.entries.map((entry) => entry.totalStrokes);
    return { courseId, plays: board.plays, bestScore: scores[0] ?? null, averageScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null };
  }
}

export class ApiClient implements ScoreService {
  private readonly baseUrl = import.meta.env.VITE_API_URL as string | undefined;
  private readonly local = new LocalLeaderboard();
  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
    if (!response.ok) throw new Error(`API request failed (${response.status})`);
    return response.json() as Promise<T>;
  }
  startRun(request: StartRunRequest): Promise<RunTicket | null> {
    return this.baseUrl ? this.request<RunTicket>('/v1/runs', { method: 'POST', body: JSON.stringify(request) }) : this.local.startRun(request);
  }
  finishRun(request: FinishRunRequest, ticket: RunTicket | null): Promise<FinishRunResponse | null> {
    return this.baseUrl ? this.request<FinishRunResponse>(`/v1/runs/${ticket?.runId}/finish`, { method: 'POST', headers: { authorization: `Bearer ${ticket?.token ?? ''}` }, body: JSON.stringify(request) }) : this.local.finishRun(request, ticket);
  }
  leaderboard(courseId: string): Promise<LeaderboardResponse> { return this.baseUrl ? this.request(`/v1/leaderboard?courseId=${encodeURIComponent(courseId)}`) : this.local.leaderboard(courseId); }
  stats(courseId: string): Promise<CourseStats> { return this.baseUrl ? this.request(`/v1/stats?courseId=${encodeURIComponent(courseId)}`) : this.local.stats(courseId); }
}
