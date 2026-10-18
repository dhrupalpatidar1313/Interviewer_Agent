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
    signal: AbortSignal.timeout(15_000),
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

/** Retries a few times: this is the only way the candidate's results get saved, so do not give up easily. */
export async function reportInterviewComplete(interviewId: string, payload: CompletionPayload): Promise<void> {
  const path = `/internal/interviews/${encodeURIComponent(interviewId)}/complete`;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await request(path, { method: 'POST', body: JSON.stringify(payload) });
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError;
}
