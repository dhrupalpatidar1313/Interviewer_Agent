import { cfg } from './env.js';
import type { CompletionPayload, InterviewContext } from './types.js';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${cfg.apiUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-internal-key': cfg.internalKey,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${init.method ?? 'GET'} ${path} failed with ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export function fetchInterviewContext(interviewId: string): Promise<InterviewContext> {
  return request<InterviewContext>(`/internal/interviews/${encodeURIComponent(interviewId)}/context`);
}

export function markInterviewStarted(interviewId: string): Promise<{ ok: boolean }> {
  return request(`/internal/interviews/${encodeURIComponent(interviewId)}/started`, {
    method: 'POST',
    body: '{}',
  });
}

/** Tells the API the candidate dropped (with the deadline for coming back) or returned (null). */
export function reportPresence(interviewId: string, rejoinUntil: number | null): Promise<{ ok: boolean }> {
  return request(`/internal/interviews/${encodeURIComponent(interviewId)}/presence`, {
    method: 'POST',
    body: JSON.stringify({ rejoinUntil }),
  });
}

/**
 * Backs off for up to ~45 seconds: this is the only way the candidate's results get saved, so a brief API
 * restart or network blip must not lose them. The deadline keeps us inside the worker's shutdown window.
 */
export async function reportInterviewComplete(interviewId: string, payload: CompletionPayload): Promise<void> {
  const path = `/internal/interviews/${encodeURIComponent(interviewId)}/complete`;
  const deadline = Date.now() + 45_000;
  const body = JSON.stringify(payload);
  let lastError: unknown;
  for (let attempt = 1; ; attempt++) {
    try {
      await request(path, { method: 'POST', body });
      return;
    } catch (err) {
      lastError = err;
      const delay = Math.min(1000 * 2 ** (attempt - 1), 10_000);
      if (Date.now() + delay > deadline) throw lastError;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
