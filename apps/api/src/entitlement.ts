import { env } from './env.js';
import { providerSupports, STAGES, type ProviderId, type Stage } from './providers.js';
import { store, type ModelSelection, type StageSelection } from './store/index.js';

export type Entitlement =
  /** The candidate's own keys are saved and chosen for every stage. */
  | { kind: 'byok'; selection: Record<Stage, StageSelection> }
  /** One free interview on the platform's own models. */
  | { kind: 'demo'; maxMinutes: number }
  | { kind: 'blocked'; code: 'PROVIDER_KEYS_REQUIRED' | 'DEMO_CAPACITY'; message: string };

function startOfUtcDay(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** A selection is usable only if every stage has a provider that serves it and a key saved for that provider. */
function completeSelection(selection: ModelSelection, haveKey: Set<string>): Record<Stage, StageSelection> | null {
  const out: Partial<Record<Stage, StageSelection>> = {};
  for (const stage of STAGES) {
    const chosen = selection[stage];
    if (!chosen || !haveKey.has(chosen.provider) || !providerSupports(chosen.provider as ProviderId, stage)) return null;
    out[stage] = chosen;
  }
  return out as Record<Stage, StageSelection>;
}

/**
 * Decides how this candidate's next interview is paid for. Their own keys win; otherwise they get one free demo
 * (counted once it actually started and did not fail), within per-user and platform-wide daily caps.
 */
export async function resolveEntitlement(userId: string): Promise<Entitlement> {
  const [selection, keys] = await Promise.all([store.getSelection(userId), store.listProviderKeys(userId)]);
  const own = completeSelection(selection, new Set(keys.map((k) => k.provider)));
  if (own) return { kind: 'byok', selection: own };

  const needKeys = (message: string): Entitlement => ({ kind: 'blocked', code: 'PROVIDER_KEYS_REQUIRED', message });

  if (!env.DEMO_ENABLED) return needKeys('Add your own API keys in Settings to start an interview.');

  const demoUsed = await store.countInterviews({ userId, mode: 'demo', statuses: ['in_progress', 'completed'] });
  if (demoUsed > 0) {
    return needKeys('You have used your free demo interview. Add your own API keys in Settings to keep practising.');
  }

  // Attempts that really ran (even if they failed) cost the platform something, so they are capped too.
  const since = startOfUtcDay();
  const ran: ('in_progress' | 'completed' | 'failed')[] = ['in_progress', 'completed', 'failed'];
  const [mine, everyone] = await Promise.all([
    store.countInterviews({ userId, mode: 'demo', statuses: ran, createdSince: since }),
    env.DEMO_DAILY_LIMIT > 0 ? store.countInterviews({ mode: 'demo', statuses: ran, createdSince: since }) : Promise.resolve(0),
  ]);
  if (mine >= env.DEMO_ATTEMPTS_PER_DAY) {
    return {
      kind: 'blocked',
      code: 'DEMO_CAPACITY',
      message: 'You have tried the demo several times today. Try again tomorrow, or add your own API keys in Settings to carry on now.',
    };
  }
  if (env.DEMO_DAILY_LIMIT > 0 && everyone >= env.DEMO_DAILY_LIMIT) {
    return {
      kind: 'blocked',
      code: 'DEMO_CAPACITY',
      message: 'The free demo has reached its limit for today. Try again tomorrow, or add your own API keys in Settings to start now.',
    };
  }
  return { kind: 'demo', maxMinutes: env.DEMO_MAX_MINUTES };
}
