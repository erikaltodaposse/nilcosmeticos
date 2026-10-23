import express from 'express';
import { ah, requireRole, sendError } from '../http.js';
import { todayKey, isDateKey } from '../lib/date.js';
import { logAudit } from '../lib/audit.js';
import { loadTemplate, createChecklistVersion, getSettings, isLateCheckout } from '../lib/checklist.js';
import { loadDayRows, summarize, failureRanking, historyRow } from '../lib/report.js';
import { daysCsv, buildBackup } from '../lib/export.js';
import { getNfcToken, rotateNfcToken, isNfcRequired } from '../lib/nfc.js';
import { DEFAULT_SECTIONS, DEFAULT_CLEANING_FOCUS } from '../lib/defaults.js';
import { parseChecklist, parseWeekdayList, parseSettings, parsePost } from '../lib/validate.js';

async function templateResponse(db, weekday) {
  const t = await loadTemplate(db, weekday);
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

async function settingsResponse(db) {
  const s = await getSettings(db);
  return {
    meta_pontos: s.meta,
    turno_inicio: s.shiftStart,
    turno_fim: s.shiftEnd,
    bonus_base: Number(s.raw.bonus_base) || 0,
    nome_loja: s.storeName,
    dias_expediente: s.workdays,
    ponto_exige_nfc: s.raw.ponto_exige_nfc === '1',
  };
}

/** Lê ?from, ?to e ?user_id. Sem from/to, o período é tudo. Responde o erro e devolve null se algo for inválido. */
async function reportQuery(req, res) {
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
    ? await db.get("SELECT * FROM users WHERE id = ? AND role = 'employee'", [id])
    : await db.get("SELECT * FROM users WHERE role = 'employee' AND active = 1 ORDER BY id LIMIT 1");
  if (!employee) {
    sendError(res, 404, 'employee_not_found', 'Nenhuma funcionária cadastrada.');
    return null;
  }
  const settings = await getSettings(db);
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

  router.get('/summary', ah(async (req, res) => {
    const q = await reportQuery(req, res);
    if (!q) return;
    const rows = await loadDayRows(q.db, q.employee.id, q.from, q.to);
    const bonusBase = Number(q.settings.raw.bonus_base) || 0;
    res.json({
      employee: { id: q.employee.id, name: q.employee.name },
      period: { from: q.from, to: q.to, today: q.today },
      meta: q.settings.meta,
      bonus_base: bonusBase,
      summary: summarize(rows, {
        today: q.today,
        meta: q.settings.meta,
        bonusBase,
        workdays: q.settings.workdays,
        // Sem data inicial, as faltas contam desde o cadastro da funcionária.
        from: q.from ?? q.employee.created_at.slice(0, 10),
        to: q.to,
        isLate: q.isLate,
      }),
    });
  }));

  router.get('/days', ah(async (req, res) => {
    const q = await reportQuery(req, res);
    if (!q) return;
    const rows = await loadDayRows(q.db, q.employee.id, q.from, q.to);
    res.json({
      employee: { id: q.employee.id, name: q.employee.name },
      meta: q.settings.meta,
      days: rows.map((r) => historyRow(r, q)).reverse(),
    });
  }));

  router.get('/failures', ah(async (req, res) => {
    const q = await reportQuery(req, res);
    if (!q) return;
    const rows = await loadDayRows(q.db, q.employee.id, q.from, q.to);
    res.json({ employee: { id: q.employee.id, name: q.employee.name }, failures: failureRanking(rows, q.today) });
  }));

  // ---------- Exportação ----------

  router.get('/export.csv', ah(async (req, res) => {
    const q = await reportQuery(req, res);
    if (!q) return;
    const rows = await loadDayRows(q.db, q.employee.id, q.from, q.to);
    const name = `checkpoint-${q.from ?? 'inicio'}-a-${q.to ?? q.today}.csv`;
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${name}"`);
    res.send(daysCsv(rows, { employeeName: q.employee.name, meta: q.settings.meta, isLate: q.isLate }));
  }));

  router.get('/backup.json', ah(async (req, res) => {
    const db = req.app.locals.db;
    const backup = await buildBackup(db, req.app.locals.now());
    await logAudit(db, req.user.id, 'backup.download', null, req.app.locals.now());
    res.set('Content-Disposition', `attachment; filename="checkpoint-backup-${todayKey(req.app.locals.now())}.json"`);
    res.json(backup);
  }));

  // ---------- Configurações ----------

  router.get('/settings', ah(async (req, res) => {
    res.json({ settings: await settingsResponse(req.app.locals.db) });
  }));

  router.put('/settings', ah(async (req, res) => {
    const db = req.app.locals.db;
    const parsed = parseSettings(req.body);
    if (parsed.error) return sendError(res, 400, 'invalid_settings', parsed.error);
    const merged = { ...(await getSettings(db)).raw, ...parsed.value };
    if (merged.turno_inicio >= merged.turno_fim) {
      return sendError(res, 400, 'invalid_settings', 'O fim do turno precisa ser depois do início.');
    }
    await db.batch(
      Object.entries(parsed.value).map(([key, value]) => [
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, value],
      ]),
    );
    await logAudit(db, req.user.id, 'settings.update', parsed.value, req.app.locals.now());
    res.json({ settings: await settingsResponse(db) });
  }));

  // ---------- Etiqueta NFC ----------

  router.get('/nfc', ah(async (req, res) => {
    const db = req.app.locals.db;
    res.json({ path: `/ponto/${await getNfcToken(db)}`, required: await isNfcRequired(db) });
  }));

  router.post('/nfc/rotate', ah(async (req, res) => {
    const db = req.app.locals.db;
    const token = await rotateNfcToken(db);
    await logAudit(db, req.user.id, 'nfc.rotate', null, req.app.locals.now());
    res.json({ path: `/ponto/${token}`, required: await isNfcRequired(db) });
  }));

  // ---------- Checklist ----------

  router.get('/checklist/:weekday', ah(async (req, res) => {
    res.json({ checklist: await templateResponse(req.app.locals.db, req.weekday) });
  }));

  // Salvar cria nova versão: vale de hoje (se o dia ainda estiver vazio) em diante; o passado não muda.
  // `also_weekdays` copia blocos e tarefas para outros dias, cada um mantendo o próprio foco de limpeza.
  router.put('/checklist/:weekday', ah(async (req, res) => {
    const db = req.app.locals.db;
    const parsed = parseChecklist(req.body);
    if (parsed.error) return sendError(res, 400, 'invalid_checklist', parsed.error);
    const others = parseWeekdayList(req.body.also_weekdays);
    if (others.error) return sendError(res, 400, 'invalid_checklist', others.error);
    const today = todayKey(req.app.locals.now());
    const targets = [req.weekday, ...others.value.filter((d) => d !== req.weekday)];
    await db.transaction(async (tx) => {
      for (const weekday of targets) {
        const focus = weekday === req.weekday
          ? parsed.value.cleaning_focus
          : (await loadTemplate(tx, weekday))?.cleaning_focus ?? null;
        await createChecklistVersion(tx, weekday, { ...parsed.value, cleaning_focus: focus }, today);
      }
      await logAudit(tx, req.user.id, 'checklist.save', { weekdays: targets, ...parsed.value }, req.app.locals.now());
    });
    res.json({ checklist: await templateResponse(db, req.weekday), saved_weekdays: targets });
  }));

  router.post('/checklist/:weekday/restore', ah(async (req, res) => {
    const db = req.app.locals.db;
    const today = todayKey(req.app.locals.now());
    await db.transaction(async (tx) => {
      await createChecklistVersion(
        tx,
        req.weekday,
        { cleaning_focus: DEFAULT_CLEANING_FOCUS[req.weekday], sections: DEFAULT_SECTIONS },
        today,
      );
      await logAudit(tx, req.user.id, 'checklist.restore', { weekday: req.weekday }, req.app.locals.now());
    });
    res.json({ checklist: await templateResponse(db, req.weekday) });
  }));

  // ---------- Roteiro de posts ----------

  router.get('/posts', ah(async (req, res) => {
    const posts = await req.app.locals.db.all(`SELECT ${POST_COLUMNS} FROM posts WHERE active = 1 ORDER BY weekday, slot, id`);
    res.json({ posts });
  }));

  router.post('/posts', ah(async (req, res) => {
    const db = req.app.locals.db;
    const parsed = parsePost(req.body);
    if (parsed.error) return sendError(res, 400, 'invalid_post', parsed.error);
    const p = parsed.value;
    const id = (await db.run(
      'INSERT INTO posts (weekday, slot, channel, product_line, hook, caption, cta) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [p.weekday, p.slot, p.channel, p.product_line, p.hook, p.caption, p.cta],
    )).lastInsertRowid;
    await logAudit(db, req.user.id, 'post.create', { id, ...p }, req.app.locals.now());
    res.status(201).json({ post: await db.get(`SELECT ${POST_COLUMNS} FROM posts WHERE id = ?`, [id]) });
  }));

  router.get('/posts/:postId', ah(async (req, res) => {
    const post = await req.app.locals.db.get(`SELECT ${POST_COLUMNS} FROM posts WHERE id = ? AND active = 1`, [req.postId]);
    if (!post) return sendError(res, 404, 'post_not_found', 'Post não encontrado.');
    res.json({ post });
  }));

  router.put('/posts/:postId', ah(async (req, res) => {
    const db = req.app.locals.db;
    if (!(await db.get('SELECT 1 FROM posts WHERE id = ? AND active = 1', [req.postId]))) {
      return sendError(res, 404, 'post_not_found', 'Post não encontrado.');
    }
    const parsed = parsePost(req.body);
    if (parsed.error) return sendError(res, 400, 'invalid_post', parsed.error);
    const p = parsed.value;
    await db.run(
      'UPDATE posts SET weekday = ?, slot = ?, channel = ?, product_line = ?, hook = ?, caption = ?, cta = ? WHERE id = ?',
      [p.weekday, p.slot, p.channel, p.product_line, p.hook, p.caption, p.cta, req.postId],
    );
    await logAudit(db, req.user.id, 'post.update', { id: req.postId, ...p }, req.app.locals.now());
    res.json({ post: await db.get(`SELECT ${POST_COLUMNS} FROM posts WHERE id = ?`, [req.postId]) });
  }));

  // Exclusão lógica, para o backup e o histórico continuarem consistentes.
  router.delete('/posts/:postId', ah(async (req, res) => {
    const db = req.app.locals.db;
    const { changes } = await db.run('UPDATE posts SET active = 0 WHERE id = ? AND active = 1', [req.postId]);
    if (!changes) return sendError(res, 404, 'post_not_found', 'Post não encontrado.');
    await logAudit(db, req.user.id, 'post.delete', { id: req.postId }, req.app.locals.now());
    res.json({ ok: true });
  }));

  return router;
}
