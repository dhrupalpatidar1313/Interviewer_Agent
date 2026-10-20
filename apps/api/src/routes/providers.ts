import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { last4 } from '../crypto.js';
import { resolveEntitlement } from '../entitlement.js';
import { env } from '../env.js';
import { HttpError, rateLimit } from '../http.js';
import { getSecretBox, keyContext } from '../keys.js';
import {
  isProviderId,
  PROVIDER_IDS,
  PROVIDERS,
  providerSupports,
  STAGES,
  validateKey,
  validateKeyForTests,
  type ModelLists,
  type ProviderId,
} from '../providers.js';
import { store, type ModelSelection, type StageSelection } from '../store/index.js';

// The in-memory backend only exists for tests, which must never reach out to real providers.
const check = env.STORE_BACKEND === 'memory' ? validateKeyForTests : validateKey;

export const providersRouter = Router();
providersRouter.use(requireAuth);

// Saving a key makes the server call the provider on the person's behalf, so keep that on a short leash.
const keyLimiter = rateLimit(20, 15 * 60 * 1000, (req) => req.user?.id);

/** Model lists fetched with a stored key, kept briefly so opening Settings does not hit every provider each time. */
const MODEL_CACHE_MS = 10 * 60 * 1000;
const modelCache = new Map<string, { at: number; models: ModelLists }>();

function cacheKey(userId: string, provider: string): string {
  return `${userId}:${provider}`;
}

function parseProvider(value: string): ProviderId {
  if (!isProviderId(value)) throw new HttpError(404, 'Unknown provider.', 'UNKNOWN_PROVIDER');
  return value;
}

function describeEntitlement(e: Awaited<ReturnType<typeof resolveEntitlement>>) {
  if (e.kind === 'blocked') return { kind: e.kind, code: e.code, message: e.message };
  if (e.kind === 'demo') return { kind: e.kind, maxMinutes: e.maxMinutes };
  return { kind: e.kind };
}

providersRouter.get('/', async (req, res) => {
  const userId = req.user!.id;
  const [keys, selection, entitlement] = await Promise.all([
    store.listProviderKeys(userId),
    store.getSelection(userId),
    resolveEntitlement(userId),
  ]);
  const byProvider = new Map(keys.map((k) => [k.provider, k]));
  res.json({
    providers: PROVIDER_IDS.map((id) => {
      const info = PROVIDERS[id];
      const saved = byProvider.get(id);
      return {
        id,
        label: info.label,
        stages: info.stages,
        keyUrl: info.keyUrl,
        keyNote: info.keyNote ?? null,
        defaults: info.defaults,
        voices: info.voices ?? null,
        configured: !!saved,
        last4: saved?.last4 ?? null,
        validatedAt: saved?.validatedAt ?? null,
      };
    }),
    selection,
    entitlement: describeEntitlement(entitlement),
    // False when the server has no encryption secret, so the page can say so instead of failing on save.
    canSaveKeys: await canSaveKeys(),
  });
});

async function canSaveKeys(): Promise<boolean> {
  try {
    getSecretBox();
    return true;
  } catch {
    return false;
  }
}

const keyBody = z.object({ apiKey: z.string().min(1, 'Paste your API key').max(500) });

providersRouter.put('/keys/:provider', keyLimiter, async (req, res) => {
  const provider = parseProvider(String(req.params.provider));
  const { apiKey } = keyBody.parse(req.body);
  const box = getSecretBox(); // fail early (503) before calling the provider
  const userId = req.user!.id;

  const result = await check(provider, apiKey);
  if (!result.ok) {
    throw new HttpError(result.reason === 'invalid' ? 422 : 502, result.message, result.reason === 'invalid' ? 'KEY_INVALID' : 'PROVIDER_UNREACHABLE');
  }

  const key = apiKey.trim();
  await store.upsertProviderKey(userId, provider, { ...box.encrypt(key, keyContext(userId, provider)), last4: last4(key) });
  modelCache.set(cacheKey(userId, provider), { at: Date.now(), models: result.models });
  res.json({ provider, configured: true, last4: last4(key), models: result.models });
});

providersRouter.delete('/keys/:provider', async (req, res) => {
  const provider = parseProvider(String(req.params.provider));
  const userId = req.user!.id;
  await store.deleteProviderKey(userId, provider);
  modelCache.delete(cacheKey(userId, provider));

  // A stage that relied on this key can no longer run, so clear it rather than leave a selection that cannot work.
  const selection = await store.getSelection(userId);
  let changed = false;
  for (const stage of STAGES) {
    if (selection[stage]?.provider === provider) {
      selection[stage] = null;
      changed = true;
    }
  }
  if (changed) await store.saveSelection(userId, selection);
  res.json({ ok: true, selection });
});

/** Models available to this person for one provider, using the key they saved. */
providersRouter.get('/:provider/models', async (req, res) => {
  const provider = parseProvider(String(req.params.provider));
  const userId = req.user!.id;
  const cached = modelCache.get(cacheKey(userId, provider));
  if (cached && Date.now() - cached.at < MODEL_CACHE_MS) {
    res.json({ provider, models: cached.models });
    return;
  }
  const stored = await store.getProviderKey(userId, provider);
  if (!stored) throw new HttpError(404, `Add your ${PROVIDERS[provider].label} key first.`, 'KEY_REQUIRED');
  const apiKey = getSecretBox().decrypt(stored, keyContext(userId, provider));
  const result = await check(provider, apiKey);
  if (!result.ok) {
    throw new HttpError(result.reason === 'invalid' ? 422 : 502, result.message, result.reason === 'invalid' ? 'KEY_INVALID' : 'PROVIDER_UNREACHABLE');
  }
  modelCache.set(cacheKey(userId, provider), { at: Date.now(), models: result.models });
  res.json({ provider, models: result.models });
});

const stageBody = z
  .object({
    provider: z.string().min(1).max(40),
    model: z.string().trim().min(1).max(120),
    voice: z.string().trim().max(120).optional(),
  })
  .nullable()
  .optional();

const selectionBody = z.object({ stt: stageBody, llm: stageBody, tts: stageBody });

providersRouter.put('/selection', async (req, res) => {
  const userId = req.user!.id;
  const body = selectionBody.parse(req.body);
  const [current, keys] = await Promise.all([store.getSelection(userId), store.listProviderKeys(userId)]);
  const haveKey = new Set(keys.map((k) => k.provider));

  const next: ModelSelection = { ...current };
  for (const stage of STAGES) {
    const chosen = body[stage];
    if (chosen === undefined) continue; // not mentioned: leave it as it was
    if (chosen === null) {
      next[stage] = null;
      continue;
    }
    if (!isProviderId(chosen.provider) || !providerSupports(chosen.provider, stage)) {
      throw new HttpError(400, `${chosen.provider} cannot be used for ${STAGE_NAMES[stage]}.`, 'PROVIDER_STAGE_MISMATCH');
    }
    if (!haveKey.has(chosen.provider)) {
      throw new HttpError(400, `Add your ${PROVIDERS[chosen.provider].label} key before choosing it.`, 'KEY_REQUIRED');
    }
    const pick: StageSelection = { provider: chosen.provider, model: chosen.model };
    if (stage === 'tts') pick.voice = chosen.voice || PROVIDERS[chosen.provider].defaults.tts?.voice;
    next[stage] = pick;
  }

  await store.saveSelection(userId, next);
  res.json({ selection: next, entitlement: describeEntitlement(await resolveEntitlement(userId)) });
});

const STAGE_NAMES = { stt: 'speech to text', llm: 'the interviewer’s thinking', tts: 'the interviewer’s voice' } as const;
