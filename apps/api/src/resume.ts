import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import path from 'node:path';
import { HttpError } from './http.js';

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
/** Keep stored text bounded; the agent trims further to fit its prompt. */
export const MAX_RESUME_CHARS = 20_000;

const ALLOWED_EXT = new Set(['.pdf', '.docx', '.txt', '.md']);

export function isAllowedResumeFile(filename: string): boolean {
  return ALLOWED_EXT.has(path.extname(filename).toLowerCase());
}

function normalize(text: string): string {
  return text
    .replace(/\0/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Extracts plain text from a PDF, DOCX or text resume. Throws HttpError(422) when nothing usable is found. */
export async function extractResumeText(buffer: Buffer, filename: string): Promise<string> {
  const ext = path.extname(filename).toLowerCase();
  let raw = '';

  try {
    if (ext === '.pdf') {
      if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
        throw new HttpError(422, 'That file does not look like a valid PDF.');
      }
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      try {
        raw = (await parser.getText()).text;
      } finally {
        await parser.destroy();
      }
    } else if (ext === '.docx') {
      raw = (await mammoth.extractRawText({ buffer })).value;
    } else if (ext === '.txt' || ext === '.md') {
      raw = buffer.toString('utf8');
    } else {
      throw new HttpError(415, 'Unsupported file type. Upload a PDF, DOCX or TXT file.');
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('Resume parsing failed:', err);
    throw new HttpError(422, 'We could not read that file. Try exporting it as a PDF or DOCX again.');
  }

  const text = normalize(raw).slice(0, MAX_RESUME_CHARS);
  if (text.length < 80) {
    throw new HttpError(
      422,
      'We could not find readable text in that file. If it is a scanned image, upload a text-based PDF or DOCX instead.',
    );
  }
  return text;
}
