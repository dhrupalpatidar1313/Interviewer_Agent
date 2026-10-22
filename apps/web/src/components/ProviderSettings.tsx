'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import {
  MODEL_STAGES,
  type EntitlementInfo,
  type ModelLists,
  type ModelSelection,
  type ModelStage,
  type ProviderEntry,
  type ProvidersResponse,
  type StageSelection,
} from '@/lib/types';

type Draft = Record<ModelStage, StageSelection | null>;

const STAGE_LABEL: Record<ModelStage, string> = { stt: 'Listening', llm: 'Thinking', tts: 'Voice' };

function entitlementCopy(e: EntitlementInfo): { tone: 'ok' | 'neutral'; text: string } {
  switch (e.kind) {
    case 'byok':
      return { tone: 'ok', text: 'Ready. Your next interview runs on your own keys, with no time cap from us.' };
    case 'demo':
      return {
        tone: 'neutral',
        text: `You still have your free ${e.maxMinutes}-minute demo interview. Add your own keys any time to unlock full interviews.`,
      };
    case 'blocked':
      return { tone: 'neutral', text: e.message };
  }
}

function KeyRow({
  provider,
  disabled,
  onSaved,
  onRemoved,
}: {
  provider: ProviderEntry;
  disabled: boolean;
  onSaved: (id: string, last4: string, models: ModelLists) => void;
  onRemoved: (id: string, selection: ModelSelection) => void;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await api<{ last4: string; models: ModelLists }>(`/providers/keys/${provider.id}`, {
        method: 'PUT',
        body: { apiKey: value.trim() },
      });
      setValue('');
      setNotice('Key checked and saved.');
      onSaved(provider.id, res.last4, res.models);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await api<{ selection: ModelSelection }>(`/providers/keys/${provider.id}`, { method: 'DELETE' });
      onRemoved(provider.id, res.selection);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="provider">
      <div className="provider__head">
        <div>
          <p className="h3">{provider.label}</p>
          <p className="muted small">
            {provider.keyNote ? `${provider.keyNote} ` : ''}
            <a href={provider.keyUrl} target="_blank" rel="noopener noreferrer">
              Get a key
            </a>
          </p>
        </div>
        <div className="provider__stages">
          {provider.stages.map((s) => (
            <span className="tag" key={s}>
              {STAGE_LABEL[s]}
            </span>
          ))}
        </div>
      </div>

      {provider.configured ? (
        <div className="row row--between">
          <p className="status" data-tone="ok">
            Saved · key ending {provider.last4}
          </p>
          <button type="button" className="btn btn--quiet" onClick={remove} disabled={busy}>
            {busy ? 'Removing…' : 'Remove'}
          </button>
        </div>
      ) : (
        <form className="provider__key" onSubmit={save}>
          <label className="sr-only" htmlFor={`key-${provider.id}`}>
            {provider.label} API key
          </label>
          <input
            id={`key-${provider.id}`}
            className="input"
            type="password"
            name={`${provider.id}-api-key`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={`Paste your ${provider.label} API key`}
            autoComplete="new-password"
            spellCheck={false}
            disabled={disabled || busy}
          />
          <button className="btn btn--secondary" type="submit" disabled={disabled || busy || value.trim().length < 8}>
            {busy ? 'Checking…' : 'Check and save'}
          </button>
        </form>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function ProviderSettings() {
  const [data, setData] = useState<ProvidersResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [models, setModels] = useState<Record<string, ModelLists>>({});
  const [draft, setDraft] = useState<Draft>({ stt: null, llm: null, tts: null });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<ProvidersResponse>('/providers');
      setData(res);
      setDraft({ stt: res.selection.stt, llm: res.selection.llm, tts: res.selection.tts });
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const ensureModels = useCallback(
    async (providerId: string) => {
      if (models[providerId]) return;
      try {
        const res = await api<{ models: ModelLists }>(`/providers/${providerId}/models`);
        setModels((m) => ({ ...m, [providerId]: res.models }));
      } catch {
        // The model box falls back to free text, so a failed lookup is not worth interrupting the person for.
      }
    },
    [models],
  );

  // Fetch the model list for every provider already chosen, so the dropdowns are populated on first view.
  useEffect(() => {
    for (const stage of MODEL_STAGES) {
      const chosen = draft[stage.id];
      if (chosen) void ensureModels(chosen.provider);
    }
  }, [draft, ensureModels]);

  if (loadError) {
    return (
      <p className="alert" role="alert">
        {loadError}
      </p>
    );
  }
  if (!data) {
    return (
      <p className="muted" role="status">
        Loading…
      </p>
    );
  }

  const byId = new Map(data.providers.map((p) => [p.id, p]));
  const status = entitlementCopy(data.entitlement);

  function choose(stage: ModelStage, providerId: string) {
    setSaved(false);
    if (!providerId) {
      setDraft((d) => ({ ...d, [stage]: null }));
      return;
    }
    const provider = byId.get(providerId)!;
    const defaults = provider.defaults[stage];
    setDraft((d) => ({
      ...d,
      [stage]: {
        provider: providerId,
        model: defaults?.model ?? '',
        ...(stage === 'tts' ? { voice: defaults?.voice ?? '' } : {}),
      },
    }));
  }

  function patch(stage: ModelStage, change: Partial<StageSelection>) {
    setSaved(false);
    setDraft((d) => (d[stage] ? { ...d, [stage]: { ...d[stage]!, ...change } } : d));
  }

  async function saveSelection() {
    setSaveError(null);
    setSaving(true);
    try {
      const body: Record<string, StageSelection | null> = {};
      for (const stage of MODEL_STAGES) body[stage.id] = draft[stage.id];
      const res = await api<{ selection: ModelSelection; entitlement: EntitlementInfo }>('/providers/selection', {
        method: 'PUT',
        body,
      });
      setData((d) => (d ? { ...d, selection: res.selection, entitlement: res.entitlement } : d));
      setSaved(true);
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function onKeySaved(id: string, last4: string, list: ModelLists) {
    setModels((m) => ({ ...m, [id]: list }));
    setData((d) =>
      d ? { ...d, providers: d.providers.map((p) => (p.id === id ? { ...p, configured: true, last4 } : p)) } : d,
    );
  }

  function onKeyRemoved(id: string, selection: ModelSelection) {
    setModels((m) => {
      const { [id]: _removed, ...rest } = m;
      return rest;
    });
    setData((d) =>
      d
        ? {
            ...d,
            selection,
            providers: d.providers.map((p) => (p.id === id ? { ...p, configured: false, last4: null } : p)),
          }
        : d,
    );
    setDraft({ stt: selection.stt, llm: selection.llm, tts: selection.tts });
    void load(); // refreshes the entitlement too
  }

  return (
    <div className="stack stack--xl">
      <p className={status.tone === 'ok' ? 'notice' : 'muted'} role="status">
        {status.text}
      </p>

      {!data.canSaveKeys && (
        <p className="alert" role="alert">
          Saving your own keys is not switched on for this server yet, so the key boxes below are disabled.
        </p>
      )}

      <section className="stack" aria-labelledby="keys-heading">
        <div className="stack">
          <h2 className="h2" id="keys-heading">
            1. Your API keys
          </h2>
          <p className="muted">
            Add a key for each service you want to use. We check it with the provider, then store it encrypted. It is
            only used to run your interviews, is never shown again, and you can remove it at any time.
          </p>
        </div>
        <div>
          {data.providers.map((p) => (
            <KeyRow key={p.id} provider={p} disabled={!data.canSaveKeys} onSaved={onKeySaved} onRemoved={onKeyRemoved} />
          ))}
        </div>
      </section>

      <section className="stack" aria-labelledby="pick-heading">
        <div className="stack">
          <h2 className="h2" id="pick-heading">
            2. Choose what runs each part
          </h2>
          <p className="muted">Pick a provider for all three parts. Only providers you added a key for are offered.</p>
        </div>

        {MODEL_STAGES.map((stage) => {
          const chosen = draft[stage.id];
          const options = data.providers.filter((p) => p.configured && p.stages.includes(stage.id));
          const provider = chosen ? byId.get(chosen.provider) : undefined;
          const list = chosen ? (models[chosen.provider]?.[stage.id] ?? []) : [];
          const modelOptions = chosen && chosen.model && !list.includes(chosen.model) ? [chosen.model, ...list] : list;
          return (
            // A group with a heading rather than a <fieldset>: a <legend> sits outside the normal flow, so the page's vertical
            // spacing did not apply to it and the heading ran into the text above.
            <div className="stack" role="group" aria-labelledby={`stage-${stage.id}`} key={stage.id}>
              <h3 className="h3" id={`stage-${stage.id}`}>
                {stage.label}
              </h3>
              <p className="muted small">{stage.hint}</p>
              <div className="pick">
                <div className="field">
                  <label className="field__label" htmlFor={`prov-${stage.id}`}>
                    Provider
                  </label>
                  <select
                    id={`prov-${stage.id}`}
                    className="input"
                    value={chosen?.provider ?? ''}
                    onChange={(e) => choose(stage.id, e.target.value)}
                  >
                    <option value="">{options.length ? 'Choose a provider' : 'Add a key above first'}</option>
                    {options.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>

                {chosen && (
                  <div className="field">
                    <label className="field__label" htmlFor={`model-${stage.id}`}>
                      Model
                    </label>
                    {modelOptions.length > 0 ? (
                      <select
                        id={`model-${stage.id}`}
                        className="input"
                        value={chosen.model}
                        onChange={(e) => patch(stage.id, { model: e.target.value })}
                      >
                        {modelOptions.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={`model-${stage.id}`}
                        className="input"
                        value={chosen.model}
                        onChange={(e) => patch(stage.id, { model: e.target.value })}
                      />
                    )}
                  </div>
                )}

                {chosen && stage.id === 'tts' && (
                  <div className="field">
                    <label className="field__label" htmlFor="voice-tts">
                      Voice
                    </label>
                    {provider?.voices ? (
                      <select
                        id="voice-tts"
                        className="input"
                        value={chosen.voice ?? ''}
                        onChange={(e) => patch('tts', { voice: e.target.value })}
                      >
                        {provider.voices.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id="voice-tts"
                        className="input"
                        value={chosen.voice ?? ''}
                        onChange={(e) => patch('tts', { voice: e.target.value })}
                      />
                    )}
                    {!provider?.voices && <p className="field__hint">A voice id from your {provider?.label} account.</p>}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {saveError && (
          <p className="alert" role="alert">
            {saveError}
          </p>
        )}
        {saved && (
          <p className="notice" role="status">
            Saved.
          </p>
        )}
        <div className="row">
          <button className="btn btn--lg" type="button" onClick={saveSelection} disabled={saving}>
            {saving ? 'Saving…' : 'Save choices'}
          </button>
          <Link className="btn btn--lg btn--secondary" href="/dashboard">
            Back to dashboard
          </Link>
        </div>
      </section>
    </div>
  );
}
