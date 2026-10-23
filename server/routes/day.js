import express from 'express';
import { requireAuth, requireRole, sendError } from '../http.js';
import { isDateKey, todayKey, nowISO, weekdayOf } from '../lib/date.js';
import { findSnapshotTask } from '../lib/snapshot.js';
import { getSettings, isWorkday, getDay, ensureDay, markTask, dayView } from '../lib/checklist.js';

function today(req) {
  return todayKey(req.app.locals.now());
}

/** Dono do dia consultado: a própria funcionária, ou (para a gestora) ?user_id ou a primeira funcionária ativa. */
function targetUser(req) {
  const db = req.app.locals.db;
  if (req.user.role === 'employee') return req.user;
  const id = Number(req.query.user_id);
  if (Number.isInteger(id) && id > 0) {
    return db.prepare("SELECT * FROM users WHERE id = ? AND role = 'employee'").get(id) ?? null;
  }
  return db.prepare("SELECT * FROM users WHERE role = 'employee' AND active = 1 ORDER BY id LIMIT 1").get() ?? null;
}

function payload(req, user, date) {
  const db = req.app.locals.db;
  const settings = getSettings(db);
  const isToday = date === today(req);
  const workday = isWorkday(settings, date);
  const day = user ? getDay(db, user.id, date) : null;
  const posts = db
    .prepare('SELECT id, slot, channel, product_line, hook, caption, cta FROM posts WHERE weekday = ? AND active = 1 ORDER BY slot, id')
    .all(weekdayOf(date));
  return {
    date,
    weekday: weekdayOf(date),
    is_today: isToday,
    workday,
    editable: Boolean(req.user.role === 'employee' && isToday && workday && !day?.closed_at),
    employee: user ? { id: user.id, name: user.name } : null,
    settings: {
      meta: settings.meta,
      turno_inicio: settings.shiftStart,
      turno_fim: settings.shiftEnd,
      nome_loja: settings.storeName,
    },
    day: day ? dayView(db, day, settings) : null,
    posts,
  };
}

export function dayRouter() {
  const router = express.Router();

  router.param('date', (req, res, next, date) => {
    if (!isDateKey(date)) return sendError(res, 400, 'invalid_date', 'Data inválida. Use o formato AAAA-MM-DD.');
    next();
  });

  router.param('taskId', (req, res, next, raw) => {
    const id = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(id)) {
      return sendError(res, 400, 'invalid_task', 'Tarefa inválida.');
    }
    req.taskId = id;
    next();
  });

  router.get('/:date', requireAuth(), (req, res) => {
    const { date } = req.params;
    const user = targetUser(req);
    // Abrir a tela de hoje já congela o snapshot (brief 7.2).
    if (req.user.role === 'employee' && date === today(req) && isWorkday(getSettings(req.app.locals.db), date)) {
      ensureDay(req.app.locals.db, user.id, date);
    }
    res.json(payload(req, user, date));
  });

  // Daqui para baixo, só a funcionária e só no dia de hoje: o passado é imutável (brief 7.6).
  const writable = [
    ...requireRole('employee'),
    (req, res, next) => {
      const db = req.app.locals.db;
      if (req.params.date !== today(req)) {
        return sendError(res, 409, 'not_today', 'Só é possível registrar o dia de hoje.');
      }
      if (!isWorkday(getSettings(db), req.params.date)) {
        return sendError(res, 409, 'no_workday', 'Hoje não há expediente.');
      }
      req.day = ensureDay(db, req.user.id, req.params.date);
      if (req.day.closed_at) return sendError(res, 409, 'day_closed', 'O dia já foi fechado.');
      req.snapshot = JSON.parse(req.day.snapshot);
      next();
    },
  ];

  function autoTask(snapshot, kind) {
    for (const section of snapshot.sections) {
      const task = section.tasks.find((t) => t.auto === kind);
      if (task) return task;
    }
    return null;
  }

  router.post('/:date/checkin', writable, (req, res) => {
    const db = req.app.locals.db;
    if (req.day.check_in_at) return sendError(res, 409, 'already_checked_in', 'A entrada já foi registrada.');
    const at = nowISO(req.app.locals.now());
    db.transaction(() => {
      db.prepare('UPDATE day_records SET check_in_at = ? WHERE id = ?').run(at, req.day.id);
      const task = autoTask(req.snapshot, 'check_in');
      if (task) markTask(db, req.day.id, task.id, at);
    })();
    res.json(payload(req, req.user, req.params.date));
  });

  router.post('/:date/checkout', writable, (req, res) => {
    const db = req.app.locals.db;
    if (!req.day.check_in_at) return sendError(res, 409, 'not_checked_in', 'Registre a entrada antes da saída.');
    if (req.day.check_out_at) return sendError(res, 409, 'already_checked_out', 'A saída já foi registrada.');
    const at = nowISO(req.app.locals.now());
    db.transaction(() => {
      db.prepare('UPDATE day_records SET check_out_at = ? WHERE id = ?').run(at, req.day.id);
      const task = autoTask(req.snapshot, 'check_out');
      if (task) markTask(db, req.day.id, task.id, at);
    })();
    res.json(payload(req, req.user, req.params.date));
  });

  // Fase 2: fecha o dia e marca a tarefa automática. A Fase 3 acrescenta exigência de foto e resumo.
  router.post('/:date/close', writable, (req, res) => {
    const db = req.app.locals.db;
    if (!req.day.check_out_at) return sendError(res, 409, 'not_checked_out', 'Registre a saída antes de fechar o dia.');
    const at = nowISO(req.app.locals.now());
    db.transaction(() => {
      const task = autoTask(req.snapshot, 'close');
      if (task) markTask(db, req.day.id, task.id, at);
      db.prepare('UPDATE day_records SET closed_at = ? WHERE id = ?').run(at, req.day.id);
    })();
    res.json(payload(req, req.user, req.params.date));
  });

  function manualTask(req, res) {
    const task = findSnapshotTask(req.snapshot, req.taskId);
    if (!task) {
      sendError(res, 404, 'task_not_found', 'Esta tarefa não faz parte do checklist de hoje.');
      return null;
    }
    if (task.auto) {
      sendError(res, 409, 'auto_task', 'Esta tarefa é marcada pelo próprio app.');
      return null;
    }
    return task;
  }

  router.put('/:date/tasks/:taskId', writable, (req, res) => {
    const task = manualTask(req, res);
    if (!task) return;
    markTask(req.app.locals.db, req.day.id, task.id, nowISO(req.app.locals.now()));
    res.json(payload(req, req.user, req.params.date));
  });

  router.delete('/:date/tasks/:taskId', writable, (req, res) => {
    const task = manualTask(req, res);
    if (!task) return;
    req.app.locals.db.prepare('DELETE FROM task_checks WHERE day_id = ? AND task_id = ?').run(req.day.id, task.id);
    res.json(payload(req, req.user, req.params.date));
  });

  return router;
}
