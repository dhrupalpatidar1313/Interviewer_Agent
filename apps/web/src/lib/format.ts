export function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function durationMinutes(startIso: string | null, endIso: string | null): number | null {
  if (!startIso || !endIso) return null;
  const ms = Date.parse(endIso) - Date.parse(startIso);
  return Number.isFinite(ms) && ms >= 0 ? Math.max(1, Math.round(ms / 60_000)) : null;
}

export const RATING_LABELS: Record<number, string> = {
  1: 'Needs work',
  2: 'Developing',
  3: 'Solid',
  4: 'Strong',
  5: 'Excellent',
};

export function endedByLabel(endedBy: string | null): string {
  switch (endedBy) {
    case 'agent_completed':
      return 'Finished';
    case 'candidate_ended':
      return 'Ended by you';
    case 'candidate_left':
    case 'participant_disconnected':
    case 'job_shutdown':
    case 'user_initiated':
      return 'Ended early';
    case 'time_limit':
      return 'Time limit reached';
    case 'timeout':
      return 'Timed out';
    case 'no_response':
      return 'No response heard';
    case 'provider_error':
      return 'Stopped by a technical problem';
    default:
      return endedBy ? 'Ended early' : 'Finished';
  }
}

/** What the candidate sees when the agent publishes an `interview_error` attribute. */
export function interviewErrorCopy(code: string | undefined): string | null {
  switch (code) {
    case 'provider_error':
      return 'The interviewer ran into a technical problem and had to stop. What you answered so far is being saved.';
    case 'key_rejected':
      return 'One of your API keys was rejected by its provider, so the interview had to stop. What you answered so far is being saved. Check your keys in Settings.';
    case 'model_unavailable':
      return 'A model you chose is no longer available from its provider, so the interview had to stop. What you answered so far is being saved. Pick another model in Settings.';
    case 'rate_limited':
      return 'Your provider is limiting requests on your account right now, so the interview had to stop. What you answered so far is being saved. Try again in a few minutes.';
    case 'demo_capacity':
      return 'The free demo is at capacity right now, so the interview had to stop. Try again later, or add your own API keys in Settings to start straight away.';
    case undefined:
    case '':
      return null;
    default:
      return 'Something went wrong on the interviewer side. What you answered so far is being saved.';
  }
}

/** Turns the raw LiveKit connection errors into something a candidate can act on. */
export function friendlyRoomError(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  const lower = message.toLowerCase();
  if (lower.includes('permission') || lower.includes('notallowed')) {
    return 'Your browser blocked the microphone. Allow microphone access for this site, then try again.';
  }
  if (lower.includes('timeout') || lower.includes('could not establish') || lower.includes('websocket')) {
    return 'We could not connect to the interview room. Check your internet connection and try again.';
  }
  if (lower.includes('token') || lower.includes('unauthorized') || lower.includes('expired')) {
    return 'Your interview link expired. Go back to your dashboard and open the interview again.';
  }
  return 'There was a problem with the connection. Check your internet connection; the interview keeps trying to reconnect.';
}

/** Maps getUserMedia failures to actionable text. Returns null when the microphone is usable. */
export function micErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Your browser blocked the microphone. Allow microphone access for this site (the lock icon in the address bar), then press Start again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone was found. Plug one in or choose one in your system settings, then press Start again.';
    case 'NotReadableError':
    case 'AbortError':
      return 'Your microphone is in use by another app. Close it and press Start again.';
    default:
      return 'We could not start your microphone. Check your browser and system settings, then press Start again.';
  }
}
