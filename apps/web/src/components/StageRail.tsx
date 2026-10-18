import { STAGES, type Stage } from '@/lib/types';

/** The interview always runs these five stages in order, so an ordered list is the honest structure. */
export function StageRail({
  current,
  withDescriptions = false,
}: {
  current?: Stage | null;
  withDescriptions?: boolean;
}) {
  const currentIndex = current ? STAGES.findIndex((s) => s.id === current) : -1;
  return (
    <ol className="rail" aria-label="Interview stages">
      {STAGES.map((stage, i) => {
        const state = currentIndex < 0 ? 'todo' : i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'todo';
        return (
          <li key={stage.id} className="rail__item" data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="rail__bar" aria-hidden="true" />
            <span className="rail__name">{stage.name}</span>
            {withDescriptions && <span className="rail__desc">{stage.description}</span>}
          </li>
        );
      })}
    </ol>
  );
}
