import { RATING_LABELS } from '@/lib/format';

/** Five ascending bars, like a level meter. */
export function RatingMeter({ rating, large = false }: { rating: number; large?: boolean }) {
  const label = `${rating} out of 5, ${RATING_LABELS[rating] ?? ''}`.trim();
  return (
    <span className={`meter${large ? ' meter--lg' : ''}`} role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <i key={n} data-on={n <= rating ? 'true' : 'false'} />
      ))}
    </span>
  );
}
