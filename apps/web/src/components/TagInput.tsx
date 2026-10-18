'use client';

import { useState, type KeyboardEvent } from 'react';

interface Props {
  id: string;
  label: string;
  hint?: string;
  value: string[];
  onChange: (value: string[]) => void;
  max?: number;
  placeholder?: string;
  suggestions?: string[];
  error?: string;
}

export function TagInput({ id, label, hint, value, onChange, max = 30, placeholder, suggestions = [], error }: Props) {
  const [draft, setDraft] = useState('');

  function add(raw: string) {
    const items = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.length === 0) {
      setDraft('');
      return;
    }
    const next = [...value];
    for (const item of items) {
      if (next.length >= max) break;
      if (!next.some((t) => t.toLowerCase() === item.toLowerCase())) next.push(item.slice(0, 50));
    }
    onChange(next);
    setDraft('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  const remaining = suggestions.filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()));

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {hint && (
        <p className="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {/* The wrapper only forwards clicks to the real input; keyboard users go straight to the input. */}
      <div className="tags" onClick={() => document.getElementById(id)?.focus()}>
        {value.map((tag) => (
          <span className="tag" key={tag}>
            {tag}
            <button
              type="button"
              className="tag__remove"
              aria-label={`Remove ${tag}`}
              onClick={() => onChange(value.filter((t) => t !== tag))}
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          className="tags__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => add(draft)}
          placeholder={value.length === 0 ? placeholder : ''}
          aria-describedby={hint ? `${id}-hint` : undefined}
          aria-invalid={error ? true : undefined}
          autoComplete="off"
        />
      </div>
      {remaining.length > 0 && (
        <div className="suggest">
          {remaining.slice(0, 8).map((s) => (
            <button type="button" key={s} className="suggest__btn" onClick={() => add(s)}>
              Add {s}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
