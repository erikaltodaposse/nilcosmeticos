// Números do painel da gestora. As funções de agregação são puras; loadDayRows é a única que lê o banco.
import { snapshotTasks, FOCUS_PLACEHOLDER } from './snapshot.js';
import { dayPoints, adherence, bonusTier } from './points.js';
import { addDays, weekdayOf } from './date.js';

/**
 * Linhas de dia já com snapshot e checks: { date, check_in_at, check_out_at, closed_at, snapshot, checks: [{task_id, done_at, photo_path}] }.
 */
export function loadDayRows(db, userId, from, to) {
  const days = db
    .prepare(
      `SELECT * FROM day_records WHERE user_id = ? AND (? IS NULL OR date >= ?) AND (? IS NULL OR date <= ?)
       ORDER BY date`,
    )
    .all(userId, from, from, to, to);
  const checkStmt = db.prepare('SELECT task_id, done_at, photo_path FROM task_checks WHERE day_id = ?');
  return days.map((d) => ({ ...d, snapshot: JSON.parse(d.snapshot), checks: checkStmt.all(d.id) }));
}

/** Dia que entra nos números: trabalhado (com check) e já encerrado (fechado ou anterior a hoje). */
export function isCountable(row, today) {
  return row.checks.length > 0 && (row.date < today || Boolean(row.closed_at));
}

export function dayStats(row) {
  return dayPoints(row.snapshot, row.checks.map((c) => c.task_id));
}

/** Resumo do período. `isLate(row)` diz se a saída passou da tolerância. */
export function summarize(rows, { today, meta, bonusBase, workdays, from, to, isLate }) {
  const counted = rows.filter((r) => isCountable(r, today));
  const series = counted.map((r) => {
    const p = dayStats(r);
    return { date: r.date, points: p.earned, max: p.max, meta, ratio: p.earned / meta };
  });
  const adh = adherence(series.map((s) => ({ points: s.points, checks: 1 })), meta);
  const tier = bonusTier(adh.ratio);

  // Dias com expediente, já passados, sem nenhum registro no período.
  const worked = new Set(rows.filter((r) => r.checks.length > 0).map((r) => r.date));
  let missing = 0;
  const last = to && to < today ? to : addDays(today, -1);
  if (from) {
    for (let d = from; d <= last; d = addDays(d, 1)) {
      if (workdays.includes(weekdayOf(d)) && !worked.has(d)) missing++;
    }
  }

  return {
    worked_days: adh.workedDays,
    total_points: adh.totalPoints,
    average_points: adh.workedDays ? Math.round((adh.totalPoints / adh.workedDays) * 10) / 10 : null,
    adherence: adh.ratio,
    tier: tier ? { id: tier.id, label: tier.label, share: tier.share } : null,
    bonus_value: tier ? Math.round(bonusBase * tier.share * 100) / 100 : 0,
    late_checkouts: counted.filter(isLate).length,
    not_closed: counted.filter((r) => !r.closed_at).length,
    missing_workdays: missing,
    series,
  };
}

/** Chave estável de uma tarefa entre dias e versões: o texto do template, ainda com {foco}. */
export function taskKey(task) {
  return task.template_text ?? task.text;
}

// "Limpeza do foco do dia: {foco}" vira "Limpeza do foco do dia" no ranking, que junta vários focos.
function taskLabel(key) {
  return key.replace(/[:\s—-]*\{foco\}/g, '').trim() || key.replaceAll(FOCUS_PLACEHOLDER, 'foco do dia');
}

/** Ranking das tarefas não cumpridas nos dias contados, da mais falha para a menos. */
export function failureRanking(rows, today) {
  const byKey = new Map();
  for (const row of rows.filter((r) => isCountable(r, today))) {
    const done = new Set(row.checks.map((c) => c.task_id));
    for (const section of row.snapshot.sections) {
      for (const task of section.tasks) {
        const key = taskKey(task);
        const entry = byKey.get(key) ?? {
          task: taskLabel(key),
          section: section.title,
          offered: 0,
          missed: 0,
          missed_dates: [],
        };
        entry.offered++;
        if (!done.has(task.id)) {
          entry.missed++;
          entry.missed_dates.push(row.date);
        }
        byKey.set(key, entry);
      }
    }
  }
  return [...byKey.values()]
    .filter((e) => e.missed > 0)
    .map((e) => ({ ...e, rate: e.missed / e.offered }))
    .sort((a, b) => b.missed - a.missed || b.rate - a.rate || a.task.localeCompare(b.task, 'pt-BR'));
}

/** Linha do histórico: um dia com pontos, horários e situação. */
export function historyRow(row, { today, isLate }) {
  const p = dayStats(row);
  const photoTasks = snapshotTasks(row.snapshot).filter((t) => t.requires_photo).length;
  return {
    date: row.date,
    check_in_at: row.check_in_at,
    check_out_at: row.check_out_at,
    closed_at: row.closed_at,
    late_checkout: isLate(row),
    points: p.earned,
    max: p.max,
    done: p.done,
    total: p.total,
    photos: row.checks.filter((c) => c.photo_path).length,
    photo_tasks: photoTasks,
    status: row.closed_at ? 'fechado' : row.date === today ? 'em_andamento' : row.checks.length ? 'sem_fechamento' : 'sem_registro',
  };
}
