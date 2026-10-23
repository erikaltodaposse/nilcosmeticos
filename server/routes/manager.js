import express from 'express';
import { requireRole, sendError } from '../http.js';
import { todayKey, isDateKey } from '../lib/date.js';
import { logAudit } from '../lib/audit.js';
import { loadTemplate, createChecklistVersion, getSettings, isLateCheckout } from '../lib/checklist.js';
import { loadDayRows, summarize, failureRanking, historyRow } from '../lib/report.js';
import { DEFAULT_SECTIONS, DEFAULT_CLEANING_FOCUS } from '../lib/defaults.js';
import { parseChecklist, parseWeekdayList, parseSettings, parsePost } from '../lib/validate.js';

function templateResponse(db, weekday) {
  const t = loadTemplate(db, weekday);
  return {
    weekday,
    version: t?.version ?? null,
    cleaning_focus: t?.cleaning_focus ?? null,
    sections: (t?.sections ?? []).map((s) => ({
      title: s.title,
      subtitle: s.subtitle,
      tasks: s.tasks.map((task) => ({
        text: task.text,
        points: task.points,
        requires_photo: Boolean(task.requires_photo),
        post_slot: task.post_slot,
        auto: task.auto,
      })),
    })),
  };
}

function settingsResponse(db) {
  const s = getSettings(db);
  return {
    meta_pontos: s.meta,
    turno_inicio: s.shiftStart,
    turno_fim: s.shiftEnd,
    bonus_base: Number(s.raw.bonus_base) || 0,
    nome_loja: s.storeName,
    dias_expediente: s.workdays,
  };
}

/** Lê ?from, ?to e ?user_id. Sem from/to, o período é tudo. */
function reportQuery(req, res) {
  const db = req.app.locals.db;
  const { from, to } = req.query;
  for (const v of [from, to]) {
    if (v != null && v !== '' && !isDateKey(v)) {
      sendError(res, 400, 'invalid_date', 'Data inválida. Use o formato AAAA-MM-DD.');
      return null;
    }
  }
  if (from && to && from > to) {
    sendError(res, 400, 'invalid_period', 'A data inicial precisa ser antes da final.');
    return null;
  }
  const id = Number(req.query.user_id);
  const employee = Number.isInteger(id) && id > 0
    ? db.prepare("SELECT * FROM users WHERE id = ? AND role = 'employee'").get(id)
    : db.prepare("SELECT * FROM users WHERE role = 'employee' AND active = 1 ORDER BY id LIMIT 1").get();
  if (!employee) {
    sendError(res, 404, 'employee_not_found', 'Nenhuma funcionária cadastrada.');
    return null;
  }
  const settings = getSettings(db);
  return {
    db,
    employee,
    settings,
    from: from || null,
    to: to || null,
    today: todayKey(req.app.locals.now()),
    isLate: (row) => isLateCheckout(row.check_out_at, settings),
  };
}

const POST_COLUMNS = 'id, weekday, slot, channel, product_line, hook, caption, cta';

export function managerRouter() {
  const router = express.Router();
  router.use(requireRole('manager'));

  router.param('weekday', (req, res, next, raw) => {
    if (!/^[0-6]$/.test(raw)) return sendError(res, 400, 'invalid_weekday', 'Dia da semana inválido (0 a 6).');
    req.weekday = Number(raw);
    next();
  });

  router.param('postId', (req, res, next, raw) => {
    if (!/^\d+$/.test(raw)) return sendError(res, 400, 'invalid_post', 'Post inválido.');
    req.postId = Number(raw);
    next();
  });

  // ---------- Painel ----------

  router.get('/summary', (req, res) => {
    const q = reportQuery(req, res);
    if (!q) return;
    const rows = loadDayRows(q.db, q.employee.id, q.from, q.to);
    // Sem data inicial, as faltas contam desde o cadastro da funcionária.
    const from = q.from ?? q.employee.created_at.slice(0, 10);
    res.json({
      employee: { id: q.employee.id, name: q.employee.name },
      period: { from: q.from, to: q.to, today: q.today },
      meta: q.settings.meta,
      bonus_base: Number(q.settings.raw.bonus_base) || 0,
      summary: summarize(rows, {
        today: q.today,
        meta: q.settings.meta,
        bonusBase: Number(q.settings.raw.bonus_base) || 0,
        workdays: q.settings.workdays,
        from,
        to: q.to,
        isLate: q.isLate,
      }),
    });
  });

  router.get('/days', (req, res) => {
    const q = reportQuery(req, res);
    if (!q) return;
    const rows = loadDayRows(q.db, q.employee.id, q.from, q.to);
    res.json({
      employee: { id: q.employee.id, name: q.employee.name },
      meta: q.settings.meta,
      days: rows.map((r) => historyRow(r, q)).reverse(),
    });
  });

  router.get('/failures', (req, res) => {
    const q = reportQuery(req, res);
    if (!q) return;
    const rows = loadDayRows(q.db, q.employee.id, q.from, q.to);
    res.json({ employee: { id: q.employee.id, name: q.employee.name }, failures: failureRanking(rows, q.today) });
  });

  // ---------- Configurações ----------

  router.get('/settings', (req, res) => {
    res.json({ settings: settingsResponse(req.app.locals.db) });
  });

  router.put('/settings', (req, res) => {
    const db = req.app.locals.db;
    const parsed = parseSettings(req.body);
    if (parsed.error) return sendError(res, 400, 'invalid_settings', parsed.error);
    const merged = { ...getSettings(db).raw, ...parsed.value };
    if (merged.turno_inicio >= merged.turno_fim) {
      return sendError(res, 400, 'invalid_settings', 'O fim do turno precisa ser depois do início.');
    }
    db.transaction(() => {
      const upsert = db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      );
      for (const [key, value] of Object.entries(parsed.value)) upsert.run(key, value);
      logAudit(db, req.user.id, 'settings.update', parsed.value, req.app.locals.now());
    })();
    res.json({ settings: settingsResponse(db) });
  });

  // ---------- Checklist ----------

  router.get('/checklist/:weekday', (req, res) => {
    res.json({ checklist: templateResponse(req.app.locals.db, req.weekday) });
  });

  // Salvar cria nova versão: vale de hoje (se o dia ainda estiver vazio) em diante; o passado não muda.
  // `also_weekdays` copia blocos e tarefas para outros dias, cada um mantendo o próprio foco de limpeza.
  router.put('/checklist/:weekday', (req, res) => {
    const db = req.app.locals.db;
    const parsed = parseChecklist(req.body);
    if (parsed.error) return sendError(res, 400, 'invalid_checklist', parsed.error);
    const others = parseWeekdayList(req.body.also_weekdays);
    if (others.error) return sendError(res, 400, 'invalid_checklist', others.error);
    const today = todayKey(req.app.locals.now());
    const targets = [req.weekday, ...others.value.filter((d) => d !== req.weekday)];
    db.transaction(() => {
      for (const weekday of targets) {
        const focus = weekday === req.weekday ? parsed.value.cleaning_focus : loadTemplate(db, weekday)?.cleaning_focus ?? null;
        createChecklistVersion(db, weekday, { ...parsed.value, cleaning_focus: focus }, today);
      }
      logAudit(db, req.user.id, 'checklist.save', { weekdays: targets, ...parsed.value }, req.app.locals.now());
    })();
    res.json({ checklist: templateResponse(db, req.weekday), saved_weekdays: targets });
  });

  router.post('/checklist/:weekday/restore', (req, res) => {
    const db = req.app.locals.db;
    const today = todayKey(req.app.locals.now());
    db.transaction(() => {
      createChecklistVersion(
        db,
        req.weekday,
        { cleaning_focus: DEFAULT_CLEANING_FOCUS[req.weekday], sections: DEFAULT_SECTIONS },
        today,
      );
      logAudit(db, req.user.id, 'checklist.restore', { weekday: req.weekday }, req.app.locals.now());
    })();
    res.json({ checklist: templateResponse(db, req.weekday) });
  });

  // ---------- Roteiro de posts ----------

  router.get('/posts', (req, res) => {
    const posts = req.app.locals.db
      .prepare(`SELECT ${POST_COLUMNS} FROM posts WHERE active = 1 ORDER BY weekday, slot, id`)
      .all();
    res.json({ posts });
  });

  router.post('/posts', (req, res) => {
    const db = req.app.locals.db;
    const parsed = parsePost(req.body);
    if (parsed.error) return sendError(res, 400, 'invalid_post', parsed.error);
    const p = parsed.value;
    const id = db
      .prepare('INSERT INTO posts (weekday, slot, channel, product_line, hook, caption, cta) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(p.weekday, p.slot, p.channel, p.product_line, p.hook, p.caption, p.cta).lastInsertRowid;
    logAudit(db, req.user.id, 'post.create', { id, ...p }, req.app.locals.now());
    res.status(201).json({ post: db.prepare(`SELECT ${POST_COLUMNS} FROM posts WHERE id = ?`).get(id) });
  });

  router.get('/posts/:postId', (req, res) => {
    const post = req.app.locals.db
      .prepare(`SELECT ${POST_COLUMNS} FROM posts WHERE id = ? AND active = 1`)
      .get(req.postId);
    if (!post) return sendError(res, 404, 'post_not_found', 'Post não encontrado.');
    res.json({ post });
  });

  router.put('/posts/:postId', (req, res) => {
    const db = req.app.locals.db;
    if (!db.prepare('SELECT 1 FROM posts WHERE id = ? AND active = 1').get(req.postId)) {
      return sendError(res, 404, 'post_not_found', 'Post não encontrado.');
    }
    const parsed = parsePost(req.body);
    if (parsed.error) return sendError(res, 400, 'invalid_post', parsed.error);
    const p = parsed.value;
    db.prepare(
      'UPDATE posts SET weekday = ?, slot = ?, channel = ?, product_line = ?, hook = ?, caption = ?, cta = ? WHERE id = ?',
    ).run(p.weekday, p.slot, p.channel, p.product_line, p.hook, p.caption, p.cta, req.postId);
    logAudit(db, req.user.id, 'post.update', { id: req.postId, ...p }, req.app.locals.now());
    res.json({ post: db.prepare(`SELECT ${POST_COLUMNS} FROM posts WHERE id = ?`).get(req.postId) });
  });

  // Exclusão lógica, para o backup e o histórico continuarem consistentes.
  router.delete('/posts/:postId', (req, res) => {
    const db = req.app.locals.db;
    const changed = db.prepare('UPDATE posts SET active = 0 WHERE id = ? AND active = 1').run(req.postId).changes;
    if (!changed) return sendError(res, 404, 'post_not_found', 'Post não encontrado.');
    logAudit(db, req.user.id, 'post.delete', { id: req.postId }, req.app.locals.now());
    res.json({ ok: true });
  });

  return router;
}
