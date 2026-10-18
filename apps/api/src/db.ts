import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { env, rootDir } from './env.js';

const dbPath = path.resolve(rootDir, env.DATABASE_PATH);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS profiles (
    user_id          TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    full_name        TEXT NOT NULL,
    target_role      TEXT NOT NULL,
    experience_level TEXT NOT NULL,
    years_experience INTEGER NOT NULL,
    skills           TEXT NOT NULL,          -- JSON string[]
    focus_areas      TEXT NOT NULL,          -- JSON string[]
    linkedin_url     TEXT NOT NULL DEFAULT '',
    github_url       TEXT NOT NULL DEFAULT '',
    about            TEXT NOT NULL DEFAULT '',
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS resumes (
    user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    filename    TEXT NOT NULL,
    text        TEXT NOT NULL,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS interviews (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    room_name   TEXT NOT NULL UNIQUE,
    status      TEXT NOT NULL DEFAULT 'created',  -- created | in_progress | completed | failed
    snapshot    TEXT NOT NULL,                    -- JSON CandidateContext captured at creation
    transcript  TEXT,                             -- JSON TranscriptTurn[]
    assessments TEXT,                             -- JSON Assessment[]
    report      TEXT,                             -- JSON InterviewReport
    ended_by    TEXT,
    started_at  TEXT,
    ended_at    TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_interviews_user ON interviews(user_id, created_at DESC);
`);

type Param = string | number | bigint | null | Uint8Array;

export function one<T>(sql: string, ...params: Param[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function all<T>(sql: string, ...params: Param[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function run(sql: string, ...params: Param[]) {
  return db.prepare(sql).run(...params);
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
