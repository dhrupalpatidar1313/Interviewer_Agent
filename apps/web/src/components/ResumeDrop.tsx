'use client';

import { useState, type ChangeEvent, type DragEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { ResumeMeta } from '@/lib/types';

const MAX_BYTES = 5 * 1024 * 1024;

/** Uploads as soon as a file is chosen so the person can see what we extracted before they continue. */
export function ResumeDrop({ resume, onChange }: { resume: ResumeMeta | null; onChange: (r: ResumeMeta) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  async function upload(file: File) {
    setError(null);
    if (file.size > MAX_BYTES) {
      setError('That file is larger than 5 MB. Try a smaller PDF or DOCX.');
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('resume', file);
      const data = await api<{ resume: ResumeMeta }>('/profile/resume', { method: 'POST', body: form });
      onChange(data.resume);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void upload(file);
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void upload(file);
  }

  return (
    <div className="stack">
      <label
        className="drop"
        data-over={over ? 'true' : 'false'}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <input
          className="drop__input"
          type="file"
          accept=".pdf,.docx,.txt,.md"
          onChange={onPick}
          disabled={busy}
          aria-label="Resume file"
        />
        <span className="drop__title">
          {busy ? 'Reading your resume…' : resume ? 'Replace your resume' : 'Drop your resume here, or click to choose a file'}
        </span>
        <span className="muted small">PDF, DOCX or TXT, up to 5 MB. Use a text-based file, not a scan.</span>
      </label>

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      {resume && !busy && (
        <div className="resume-read">
          <p>
            <strong>{resume.filename}</strong>
          </p>
          <p className="muted small">We read {resume.charCount.toLocaleString()} characters of text from it.</p>
          <details style={{ marginTop: '0.75rem' }}>
            <summary>See what we read</summary>
            <p className="resume-read__text read">
              {resume.preview}
              {resume.charCount > resume.preview.length ? '…' : ''}
            </p>
          </details>
        </div>
      )}
    </div>
  );
}
