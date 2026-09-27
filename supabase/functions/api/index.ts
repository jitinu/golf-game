import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { validateHoleStrokes, validatePlayerName } from './validate.ts';

const corsHeaders = {
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-origin': '*',
  'content-type': 'application/json',
};

type ApiClient = SupabaseClient;

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function errorResponse(message: string, status: number): Response {
  return response({ error: message }, status);
}

function getClient(): ApiClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Supabase service-role environment is not configured');
  return createClient(url, key);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function clientIpHash(request: Request): Promise<string> {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return sha256Hex(forwardedFor || 'unknown');
}

async function allowRequest(client: ApiClient, key: string): Promise<boolean> {
  const { data, error } = await client.rpc('check_rate_limit', {
    p_key: key,
    p_limit: 30,
    p_window: '10 minutes',
  });
  return !error && data === true;
}

async function verifyTurnstile(token: unknown, request: Request): Promise<boolean> {
  const secret = Deno.env.get('TURNSTILE_SECRET');
  if (!secret) return true;
  if (typeof token !== 'string' || token.length === 0) return false;
  const form = new FormData();
  form.set('secret', secret);
  form.set('response', token);
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (ip) form.set('remoteip', ip);
  const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
  });
  if (!result.ok) return false;
  const payload = await result.json() as { success?: boolean };
  return payload.success === true;
}

async function createRun(request: Request, client: ApiClient): Promise<Response> {
  const ipHash = await clientIpHash(request);
  if (!await allowRequest(client, `runs:${ipHash}`)) return errorResponse('Rate limit exceeded', 429);
  const body = await request.json() as { courseId?: unknown; courseVersion?: unknown };
  if (typeof body.courseId !== 'string' || !Number.isInteger(body.courseVersion)) {
    return errorResponse('Invalid run request', 400);
  }
  const { data: course, error: courseError } = await client
    .from('courses')
    .select('id,version')
    .eq('id', body.courseId)
    .eq('version', body.courseVersion)
    .maybeSingle();
  if (courseError) return errorResponse('Unable to load course', 500);
  if (!course) return errorResponse('Course not found', 404);

  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  const { data: run, error } = await client
    .from('runs')
    .insert({
      course_id: course.id,
      course_version: course.version,
      token_hash: tokenHash,
      expires_at: expiresAt,
      client_ip_hash: ipHash,
    })
    .select('id,expires_at')
    .single();
  if (error) return errorResponse('Unable to create run', 500);
  return response({ runId: run.id, token, expiresAt: run.expires_at });
}

async function finishRun(request: Request, client: ApiClient, runId: string): Promise<Response> {
  const ipHash = await clientIpHash(request);
  if (!await allowRequest(client, `finish:${ipHash}`)) return errorResponse('Rate limit exceeded', 429);
  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return errorResponse('Missing run token', 401);
  const body = await request.json() as {
    playerName?: unknown;
    holeStrokes?: unknown;
    shots?: unknown;
    turnstileToken?: unknown;
  };
  if (!await verifyTurnstile(body.turnstileToken, request)) return errorResponse('Turnstile verification failed', 403);
  if (typeof body.playerName !== 'string') return errorResponse('Invalid player name', 400);
  const playerName = validatePlayerName(body.playerName);
  const holeStrokes = validateHoleStrokes(body.holeStrokes);
  if (!playerName.ok) return errorResponse(playerName.reason, 400);
  if (!holeStrokes.ok) return errorResponse(holeStrokes.reason, 400);
  const { data, error } = await client.rpc('finish_run', {
    p_run_id: runId,
    p_token_hash: await sha256Hex(token),
    p_player_name: playerName.value,
    p_hole_strokes: holeStrokes.value,
    p_shots: body.shots ?? [],
  });
  if (error) return errorResponse(error.message, 400);
  const result = Array.isArray(data) ? data[0] : data;
  return response({
    scoreId: result.score_id,
    totalStrokes: result.total_strokes,
    toPar: result.to_par,
    rank: result.rank,
  });
}

async function leaderboard(request: Request, client: ApiClient): Promise<Response> {
  const url = new URL(request.url);
  const courseId = url.searchParams.get('courseId');
  const parsedLimit = Number(url.searchParams.get('limit') ?? '20');
  const limit = Number.isInteger(parsedLimit) ? Math.min(100, Math.max(1, parsedLimit)) : 20;
  if (!courseId) return errorResponse('courseId is required', 400);
  const { data: scores, error: scoreError } = await client
    .from('scores')
    .select('player_name,total_strokes,to_par,created_at')
    .eq('course_id', courseId)
    .order('total_strokes', { ascending: true })
    .order('created_at', { ascending: true })
    .range(0, limit - 1);
  if (scoreError) return errorResponse('Unable to load leaderboard', 500);
  const { data: stats, error: statsError } = await client
    .from('course_stats')
    .select('plays')
    .eq('course_id', courseId)
    .maybeSingle();
  if (statsError) return errorResponse('Unable to load stats', 500);
  return response({
    courseId,
    entries: (scores ?? []).map((score, index) => ({
      rank: index + 1,
      playerName: score.player_name,
      totalStrokes: score.total_strokes,
      toPar: score.to_par,
      createdAt: score.created_at,
    })),
    plays: stats?.plays ?? 0,
  });
}

async function stats(request: Request, client: ApiClient): Promise<Response> {
  const courseId = new URL(request.url).searchParams.get('courseId');
  if (!courseId) return errorResponse('courseId is required', 400);
  const { data, error } = await client.rpc('course_stats_summary', { p_course_id: courseId });
  if (error) return errorResponse('Unable to load stats', 500);
  const summary = Array.isArray(data) ? data[0] : data;
  return response({
    courseId,
    plays: summary?.plays ?? 0,
    bestScore: summary?.best_score ?? null,
    averageScore: summary?.average_score ?? null,
  });
}

async function router(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  const client = getClient();
  const url = new URL(request.url);
  const path = (url.pathname.replace(/\/+$/, '').replace(/^\/api/, '') || '/');
  try {
    if (request.method === 'POST' && path === '/v1/runs') return await createRun(request, client);
    const finishMatch = path.match(/^\/v1\/runs\/([^/]+)\/finish$/);
    if (request.method === 'POST' && finishMatch) return await finishRun(request, client, finishMatch[1]!);
    if (request.method === 'GET' && path === '/v1/leaderboard') return await leaderboard(request, client);
    if (request.method === 'GET' && path === '/v1/stats') return await stats(request, client);
    return errorResponse('Not found', 404);
  } catch (error) {
    console.error(error);
    return errorResponse('Internal server error', 500);
  }
}

Deno.serve(router);
