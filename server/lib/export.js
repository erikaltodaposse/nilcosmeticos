// Exportação CSV e backup/restauração JSON.
import { snapshotTasks } from './snapshot.js';
import { dayStats } from './report.js';
import { timeKey, weekdayOf, nowISO } from './date.js';

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export const CSV_HEADER = [
  'data', 'dia_semana', 'funcionaria', 'entrada', 'saida', 'saida_apos_tolerancia', 'fechado_as',
  'pontos', 'meta', 'percentual_meta', 'tarefas_cumpridas', 'tarefas_total', 'fotos', 'pendentes',
];

// Separador ";" e vírgula decimal: o Excel em português abre direto, sem assistente de importação.
function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[";\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

const hour = (iso) => (iso ? timeKey(new Date(iso)) : '');
const brDate = (key) => key.split('-').reverse().join('/');

/** CSV com BOM UTF-8, uma linha por dia. */
export function daysCsv(rows, { employeeName, meta, isLate }) {
  const lines = [CSV_HEADER.join(';')];
  for (const row of rows) {
    const p = dayStats(row);
    const done = new Set(row.checks.map((c) => c.task_id));
    const pending = snapshotTasks(row.snapshot).filter((t) => !done.has(t.id)).map((t) => t.text);
    lines.push(
      [
        brDate(row.date),
        WEEKDAYS[weekdayOf(row.date)],
        employeeName,
        hour(row.check_in_at),
        hour(row.check_out_at),
        isLate(row) ? 'sim' : 'não',
        hour(row.closed_at),
        p.earned,
        meta,
        (Math.round((p.earned / meta) * 1000) / 10).toString().replace('.', ','),
        p.done,
        p.total,
        row.checks.filter((c) => c.photo_path).length,
        pending.join(' | '),
      ].map(csvCell).join(';'),
    );
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

// Ordem respeita as chaves estrangeiras na restauração. Sessões ficam de fora de propósito.
export const BACKUP_TABLES = [
  'users', 'settings', 'checklist_versions', 'checklist_sections', 'checklist_tasks',
  'day_records', 'task_checks', 'posts', 'audit_log',
];
export const BACKUP_FORMAT = 'checkpoint-nil-backup';

export function buildBackup(db, now = new Date()) {
  const tables = {};
  for (const table of BACKUP_TABLES) tables[table] = db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
  return {
    format: BACKUP_FORMAT,
    schema_version: db.pragma('user_version', { simple: true }),
    created_at: nowISO(now),
    note: 'As fotos ficam em DATA_DIR/uploads e são copiadas pelo deploy/backup.sh, não por este arquivo.',
    tables,
  };
}

/** Restaura um backup num banco vazio (já migrado). Lança erro com mensagem clara se algo não bate. */
export function restoreBackup(db, backup) {
  if (backup?.format !== BACKUP_FORMAT || typeof backup.tables !== 'object') {
    throw new Error('Arquivo não é um backup do Checkpoint Nil.');
  }
  const current = db.pragma('user_version', { simple: true });
  if (backup.schema_version > current) {
    throw new Error(`Backup feito numa versão mais nova do banco (${backup.schema_version}); atualize o código antes.`);
  }
  const hasData = BACKUP_TABLES.some((t) => db.prepare(`SELECT 1 FROM ${t} LIMIT 1`).get());
  if (hasData) throw new Error('O banco de destino já tem dados. Restaure num banco vazio.');

  const counts = {};
  db.transaction(() => {
    for (const table of BACKUP_TABLES) {
      const rows = backup.tables[table] ?? [];
      const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
      for (const row of rows) {
        const keys = Object.keys(row).filter((k) => columns.has(k));
        db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(
          ...keys.map((k) => row[k]),
        );
      }
      counts[table] = rows.length;
    }
  })();
  return counts;
}
