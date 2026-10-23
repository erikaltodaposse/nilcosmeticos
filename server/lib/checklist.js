// Acesso ao banco para checklist, configurações e registros do dia.
import { buildSnapshot, canRewriteSnapshot } from './snapshot.js';
import { dayPoints } from './points.js';
import { nowISO, weekdayOf, timeKey, minutesOf } from './date.js';

export const CHECKOUT_TOLERANCE_MIN = 10;

export function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const raw = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    raw,
    meta: Number(raw.meta_pontos) || 150,
    shiftStart: raw.turno_inicio || '13:00',
    shiftEnd: raw.turno_fim || '18:00',
    storeName: raw.nome_loja || 'Nil Cosméticos',
    workdays: (raw.dias_expediente ?? '1,2,3,4,5')
      .split(',')
      .map((d) => Number(d.trim()))
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
  };
}

export function isWorkday(settings, date) {
  return settings.workdays.includes(weekdayOf(date));
}

/** Template vigente (última versão ativa) do dia da semana, com seções e tarefas ativas em ordem. */
export function loadTemplate(db, weekday) {
  const version = db
    .prepare('SELECT * FROM checklist_versions WHERE weekday = ? AND active = 1 ORDER BY version DESC LIMIT 1')
    .get(weekday);
  if (!version) return null;
  const sections = db
    .prepare('SELECT * FROM checklist_sections WHERE version_id = ? ORDER BY position, id')
    .all(version.id);
  const taskStmt = db.prepare(
    'SELECT * FROM checklist_tasks WHERE section_id = ? AND active = 1 ORDER BY position, id',
  );
  return {
    version_id: version.id,
    version: version.version,
    weekday,
    cleaning_focus: version.cleaning_focus,
    sections: sections.map((s) => ({ title: s.title, subtitle: s.subtitle, tasks: taskStmt.all(s.id) })),
  };
}

/**
 * Salva um novo template para o dia da semana como nova versão. Dias já registrados não mudam;
 * o dia de hoje, se estiver vazio, recebe o snapshot novo (brief 7.2).
 * `data` = { cleaning_focus, sections: [{ title, subtitle, tasks: [{ text, points, requires_photo, post_slot, auto }] }] }.
 */
export function createChecklistVersion(db, weekday, data, today) {
  return db.transaction(() => {
    const now = nowISO();
    const last = db.prepare('SELECT MAX(version) AS v FROM checklist_versions WHERE weekday = ?').get(weekday).v ?? 0;
    db.prepare('UPDATE checklist_versions SET active = 0 WHERE weekday = ?').run(weekday);
    const versionId = db
      .prepare('INSERT INTO checklist_versions (weekday, version, cleaning_focus, active, created_at) VALUES (?, ?, ?, 1, ?)')
      .run(weekday, last + 1, data.cleaning_focus ?? null, now).lastInsertRowid;
    const insertSection = db.prepare(
      'INSERT INTO checklist_sections (version_id, position, title, subtitle) VALUES (?, ?, ?, ?)',
    );
    const insertTask = db.prepare(
      `INSERT INTO checklist_tasks (section_id, position, text, points, requires_photo, post_slot, auto)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    data.sections.forEach((section, sIdx) => {
      const sectionId = insertSection.run(versionId, sIdx, section.title, section.subtitle ?? null).lastInsertRowid;
      section.tasks.forEach((task, tIdx) => {
        insertTask.run(
          sectionId, tIdx, task.text, task.points,
          task.requires_photo ? 1 : 0, task.post_slot ?? null, task.auto ?? null,
        );
      });
    });

    if (weekdayOf(today) === weekday) {
      const snapshot = JSON.stringify(buildSnapshot(loadTemplate(db, weekday)));
      for (const day of db.prepare('SELECT * FROM day_records WHERE date = ?').all(today)) {
        if (canRewriteSnapshot(day, getChecks(db, day.id), today)) {
          db.prepare('UPDATE day_records SET snapshot = ? WHERE id = ?').run(snapshot, day.id);
        }
      }
    }
    return versionId;
  })();
}

export function getDay(db, userId, date) {
  return db.prepare('SELECT * FROM day_records WHERE user_id = ? AND date = ?').get(userId, date) ?? null;
}

export function getChecks(db, dayId) {
  return db.prepare('SELECT * FROM task_checks WHERE day_id = ? ORDER BY done_at').all(dayId);
}

/** Devolve o registro do dia, criando-o e congelando o snapshot se ainda não existir. */
export function ensureDay(db, userId, date) {
  const existing = getDay(db, userId, date);
  if (existing) return existing;
  const template = loadTemplate(db, weekdayOf(date));
  if (!template) throw Object.assign(new Error('Não há checklist para este dia da semana.'), { status: 409, code: 'no_checklist' });
  db.prepare(
    'INSERT OR IGNORE INTO day_records (user_id, date, snapshot, created_at) VALUES (?, ?, ?, ?)',
  ).run(userId, date, JSON.stringify(buildSnapshot(template)), nowISO());
  return getDay(db, userId, date);
}

export function markTask(db, dayId, taskId, at = nowISO()) {
  db.prepare('INSERT OR IGNORE INTO task_checks (day_id, task_id, done_at) VALUES (?, ?, ?)').run(dayId, taskId, at);
}

/** Saída depois do fim do turno + tolerância. */
export function isLateCheckout(checkOutAt, settings) {
  if (!checkOutAt) return false;
  return minutesOf(timeKey(new Date(checkOutAt))) > minutesOf(settings.shiftEnd) + CHECKOUT_TOLERANCE_MIN;
}

/** Visão do dia para a API: snapshot com estado de cada tarefa e pontos. */
export function dayView(db, day, settings) {
  const snapshot = JSON.parse(day.snapshot);
  const checks = getChecks(db, day.id);
  const byTask = new Map(checks.map((c) => [c.task_id, c]));
  return {
    id: day.id,
    date: day.date,
    check_in_at: day.check_in_at,
    check_out_at: day.check_out_at,
    closed_at: day.closed_at,
    late_checkout: isLateCheckout(day.check_out_at, settings),
    cleaning_focus: snapshot.cleaning_focus,
    sections: snapshot.sections.map((section) => ({
      title: section.title,
      subtitle: section.subtitle,
      tasks: section.tasks.map((task) => {
        const check = byTask.get(task.id);
        return { ...task, done: Boolean(check), done_at: check?.done_at ?? null, has_photo: Boolean(check?.photo_path) };
      }),
    })),
    points: { ...dayPoints(snapshot, checks.map((c) => c.task_id)), meta: settings.meta },
  };
}
