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
    case 'participant_disconnected':
    case 'job_shutdown':
    case 'user_initiated':
      return 'Ended early';
    case 'time_limit':
      return 'Time limit reached';
    case 'timeout':
      return 'Timed out';
    default:
      return endedBy ? 'Ended early' : 'Finished';
  }
}
