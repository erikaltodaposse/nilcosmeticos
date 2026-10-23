import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { config } from './config.js';

// Cada item roda uma única vez, na ordem. A posição no array é a versão (PRAGMA user_version).
// Nunca edite uma migração já publicada: acrescente outra no fim.
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('employee', 'manager')),
    email TEXT UNIQUE,
    pin_hash TEXT,
    password_hash TEXT,
    must_change_pin INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE checklist_versions (
    id INTEGER PRIMARY KEY,
    weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    version INTEGER NOT NULL,
    cleaning_focus TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    UNIQUE (weekday, version)
  );

  CREATE TABLE checklist_sections (
    id INTEGER PRIMARY KEY,
    version_id INTEGER NOT NULL REFERENCES checklist_versions(id),
    position INTEGER NOT NULL,
    title TEXT NOT NULL,
    subtitle TEXT
  );

  CREATE TABLE checklist_tasks (
    id INTEGER PRIMARY KEY,
    section_id INTEGER NOT NULL REFERENCES checklist_sections(id),
    position INTEGER NOT NULL,
    text TEXT NOT NULL,
    points INTEGER NOT NULL,
    requires_photo INTEGER NOT NULL DEFAULT 0,
    post_slot INTEGER,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE day_records (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    date TEXT NOT NULL,
    check_in_at TEXT,
    check_out_at TEXT,
    snapshot TEXT NOT NULL,
    closed_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, date)
  );

  CREATE TABLE task_checks (
    id INTEGER PRIMARY KEY,
    day_id INTEGER NOT NULL REFERENCES day_records(id),
    task_id INTEGER NOT NULL,
    done_at TEXT NOT NULL,
    photo_path TEXT,
    UNIQUE (day_id, task_id)
  );

  CREATE TABLE posts (
    id INTEGER PRIMARY KEY,
    weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    slot INTEGER NOT NULL,
    channel TEXT,
    product_line TEXT,
    hook TEXT,
    caption TEXT,
    cta TEXT,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY,
    actor_id INTEGER,
    action TEXT NOT NULL,
    payload TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE INDEX idx_day_records_date ON day_records(date);
  CREATE INDEX idx_sessions_user ON sessions(user_id);
  `,
];

export function migrate(db) {
  const current = db.pragma('user_version', { simple: true });
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
  return db.pragma('user_version', { simple: true });
}

/** Abre (e migra) um banco. Use ':memory:' nos testes. */
export function openDb(file = config.dbFile) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

// `npm run migrate` executa este arquivo diretamente.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const db = openDb();
  console.log(`Banco em ${config.dbFile} na versão ${db.pragma('user_version', { simple: true })}.`);
  db.close();
}
