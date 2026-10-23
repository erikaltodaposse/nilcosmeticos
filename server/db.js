import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';
import { config } from './config.js';

// Cada item roda uma única vez, na ordem; a posição no array é a versão (tabela _migrations).
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
  // Tarefas marcadas pelo próprio sistema (ponto de entrada, ponto de saída, fechamento do dia).
  `
  ALTER TABLE checklist_tasks ADD COLUMN auto TEXT CHECK (auto IN ('check_in', 'check_out', 'close'));
  UPDATE checklist_tasks SET auto = 'check_in' WHERE text = 'Bater ponto de entrada';
  UPDATE checklist_tasks SET auto = 'check_out' WHERE text = 'Bater ponto de saída';
  UPDATE checklist_tasks SET auto = 'close' WHERE text = 'Fechar o dia no app e enviar o resumo';
  `,
  // Horário por tarefa e postagens do dia numa tarefa só, com roteiro de prompts (pedido do Erik, 23/10).
  `
  ALTER TABLE checklist_tasks ADD COLUMN due_time TEXT;
  ALTER TABLE checklist_tasks ADD COLUMN posts INTEGER NOT NULL DEFAULT 0;

  UPDATE checklist_tasks
     SET points = (SELECT SUM(t2.points) FROM checklist_tasks t2
                    WHERE t2.section_id = checklist_tasks.section_id AND t2.post_slot IS NOT NULL AND t2.active = 1),
         text = 'Postagens do dia', posts = 1
   WHERE post_slot = 1 AND active = 1;
  UPDATE checklist_tasks SET active = 0 WHERE post_slot IN (2, 3);
  UPDATE checklist_tasks SET post_slot = NULL;

  UPDATE checklist_tasks SET due_time = CASE text
    WHEN 'Bater ponto de entrada' THEN '13:00'
    WHEN 'Abrir a loja: luzes, som, vitrine e balcão' THEN '13:05'
    WHEN 'Postar "Boa tarde" no Grupo VIP' THEN '13:15'
    WHEN 'Conferir caixa, troco e organização do balcão' THEN '13:20'
    WHEN 'Limpeza do foco do dia: {foco}' THEN '14:00'
    WHEN 'Reposição e organização de gôndolas (15 min)' THEN '15:00'
    WHEN 'Limpeza final: hall e entrada' THEN '17:30'
    WHEN 'Fechamento de caixa e relatório do dia' THEN '17:45'
    WHEN 'Apoiar o fechamento da loja com a gestora' THEN '17:55'
    WHEN 'Bater ponto de saída' THEN '18:00'
    WHEN 'Fechar o dia no app e enviar o resumo' THEN '18:05'
  END WHERE due_time IS NULL;

  ALTER TABLE posts ADD COLUMN time TEXT;
  ALTER TABLE posts ADD COLUMN kind TEXT;
  ALTER TABLE posts ADD COLUMN goal TEXT;
  ALTER TABLE posts ADD COLUMN image_prompt TEXT;
  ALTER TABLE posts ADD COLUMN text_prompt TEXT;
  -- Com data, a postagem vale só naquele dia e substitui o roteiro do dia da semana.
  ALTER TABLE posts ADD COLUMN date TEXT;
  CREATE INDEX idx_posts_date ON posts(date);
  UPDATE posts SET time = CASE slot WHEN 1 THEN '13:30' WHEN 2 THEN '15:30' ELSE '17:00' END,
                   kind = CASE slot WHEN 1 THEN 'grupo_vip' WHEN 2 THEN 'stories' ELSE 'feed' END,
                   goal = hook,
                   text_prompt = TRIM(COALESCE(caption, '') || CASE WHEN cta IS NULL THEN '' ELSE char(10) || cta END);

  CREATE TABLE post_checks (
    id INTEGER PRIMARY KEY,
    day_id INTEGER NOT NULL REFERENCES day_records(id),
    post_id INTEGER NOT NULL,
    done_at TEXT NOT NULL,
    UNIQUE (day_id, post_id)
  );
  `,
];

/**
 * Acesso ao banco com API assíncrona sobre o libSQL: arquivo SQLite local no desenvolvimento,
 * Turso na Vercel. Linhas voltam como objetos simples; números inteiros como Number.
 */
export class Db {
  constructor(client, { inTransaction = false } = {}) {
    this.client = client;
    this.inTransaction = inTransaction;
  }

  async all(sql, args = []) {
    const result = await this.client.execute({ sql, args });
    return result.rows.map((row) => Object.fromEntries(result.columns.map((col, i) => [col, row[i]])));
  }

  async get(sql, args = []) {
    return (await this.all(sql, args))[0] ?? null;
  }

  async run(sql, args = []) {
    const result = await this.client.execute({ sql, args });
    return {
      changes: result.rowsAffected,
      lastInsertRowid: result.lastInsertRowid == null ? null : Number(result.lastInsertRowid),
    };
  }

  /** Vários comandos de uma vez, atômicos, numa só ida ao banco. `statements` = [[sql, args], ...]. */
  async batch(statements) {
    if (statements.length === 0) return;
    const stmts = statements.map(([sql, args = []]) => ({ sql, args }));
    if (this.inTransaction) await this.client.batch(stmts);
    else await this.client.batch(stmts, 'write');
  }

  async exec(sql) {
    await this.client.executeMultiple(sql);
  }

  /** Roda `fn(db)` numa transação de escrita. Dentro de outra transação, reaproveita a mesma. */
  async transaction(fn) {
    if (this.inTransaction) return fn(this);
    const tx = await this.client.transaction('write');
    try {
      const result = await fn(new Db(tx, { inTransaction: true }));
      await tx.commit();
      return result;
    } catch (err) {
      await tx.rollback().catch(() => {});
      throw err;
    } finally {
      tx.close();
    }
  }

  close() {
    this.client.close();
  }
}

export async function schemaVersion(db) {
  return (await db.get('SELECT COALESCE(MAX(version), 0) AS v FROM _migrations')).v;
}

export async function migrate(db) {
  await db.exec('CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  for (let v = await schemaVersion(db); v < MIGRATIONS.length; v++) {
    await db.transaction(async (tx) => {
      await tx.exec(MIGRATIONS[v]);
      await tx.run('INSERT INTO _migrations (version, applied_at) VALUES (?, ?)', [v + 1, new Date().toISOString()]);
    });
  }
  return schemaVersion(db);
}

/**
 * Abre e migra o banco. Com TURSO_DATABASE_URL usa o Turso; senão, o arquivo em DATA_DIR/app.db.
 * `file` permite apontar outro arquivo (os testes usam um por teste).
 */
export async function openDb({ file = config.dbFile, url = config.tursoUrl, authToken = config.tursoToken } = {}) {
  let client;
  if (url) {
    client = createClient({ url, authToken });
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    client = createClient({ url: pathToFileURL(file).href });
  }
  const db = new Db(client);
  if (!url) await db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  await migrate(db);
  return db;
}

// `npm run migrate` executa este arquivo diretamente.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const db = await openDb();
  console.log(`Banco ${config.tursoUrl ? 'Turso' : config.dbFile} na versão ${await schemaVersion(db)}.`);
  db.close();
}
