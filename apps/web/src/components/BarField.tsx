import type { CSSProperties } from 'react';

// Deterministic pseudo-random so server and client render identical markup.
function rand(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Decorative meter that reads as one exchange: the interviewer's voice in ink, then the candidate's in amber.
 * Purely visual, so it is hidden from assistive tech and stops moving for people who prefer reduced motion.
 */
export function BarField({ count = 72 }: { count?: number }) {
  const turnAt = Math.floor(count * 0.7);
  const bars = Array.from({ length: count }, (_, i) => {
    const inYou = i >= turnAt;
    const span = inYou ? count - turnAt : turnAt;
    const pos = inYou ? i - turnAt : i;
    const envelope = Math.pow(Math.sin(((pos + 0.5) / span) * Math.PI), 0.7);
    const base = 0.07 + rand(i, 1) * 0.1;
    const peak = Math.min(1, 0.2 + envelope * (0.35 + rand(i, 2) * 0.65));
    const style = {
      '--base': base.toFixed(3),
      '--peak': peak.toFixed(3),
      '--dur': `${(1.4 + rand(i, 3) * 1.6).toFixed(2)}s`,
      '--delay': `${(-rand(i, 4) * 3).toFixed(2)}s`,
    } as CSSProperties;
    return <span key={i} className="bars__bar" data-hot={inYou ? 'true' : 'false'} style={style} />;
  });

  return (
    <div className="bars" aria-hidden="true">
      {bars}
    </div>
  );
}
