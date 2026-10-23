import express from 'express';
import multer from 'multer';
import { ah, requireAuth, requireRole, sendError } from '../http.js';
import { isDateKey, todayKey, nowISO, weekdayOf } from '../lib/date.js';
import { findSnapshotTask } from '../lib/snapshot.js';
import { getSettings, isWorkday, getDay, ensureDay, markTask, dayView } from '../lib/checklist.js';
import { ALLOWED_TYPES, MAX_PHOTO_BYTES, sniffImageType } from '../lib/photos.js';
import { daySummaryText, whatsappLink } from '../lib/summary.js';
import { isNfcRequired, checkNfcToken } from '../lib/nfc.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1 },
});

/** Recebe o campo "photo" e traduz os erros do multer para o formato da API. */
function receivePhoto(req, res, next) {
  upload.single('photo')(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return sendError(res, 413, 'photo_too_large', 'A foto passa de 5 MB.');
    if (err) return sendError(res, 400, 'invalid_upload', 'Não foi possível receber a foto. Tente de novo.');
    if (!req.file) return sendError(res, 400, 'photo_missing', 'Envie a foto no campo "photo".');
    const type = sniffImageType(req.file.buffer);
    if (!type || !ALLOWED_TYPES[req.file.mimetype]) {
      return sendError(res, 415, 'invalid_photo_type', 'A foto precisa ser JPEG ou PNG.');
    }
    req.photoType = type;
    next();
  });
}
function today(req) {
  return todayKey(req.app.locals.now());
}

/** Dono do dia consultado: a própria funcionária, ou (para a gestora) ?user_id ou a primeira funcionária ativa. */
async function targetUser(req) {
  const db = req.app.locals.db;
  if (req.user.role === 'employee') return req.user;
  const id = Number(req.query.user_id);
  if (Number.isInteger(id) && id > 0) {
    return db.get("SELECT * FROM users WHERE id = ? AND role = 'employee'", [id]);
  }
  return db.get("SELECT * FROM users WHERE role = 'employee' AND active = 1 ORDER BY id LIMIT 1");
}

async function payload(req, user, date) {
  const db = req.app.locals.db;
  const settings = await getSettings(db);
  const isToday = date === today(req);
  const workday = isWorkday(settings, date);
  const day = user ? await getDay(db, user.id, date) : null;
  const posts = await db.all(
    'SELECT id, slot, channel, product_line, hook, caption, cta FROM posts WHERE weekday = ? AND active = 1 ORDER BY slot, id',
    [weekdayOf(date)],
  );
  const view = day ? await dayView(db, day, settings) : null;
  const summaryText = view
    ? daySummaryText({ date, storeName: settings.storeName, employeeName: user.name, day: view })
    : null;
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
      nfc_required: settings.raw.ponto_exige_nfc === '1',
    },
    day: view,
    summary: summaryText ? { text: summaryText, whatsapp_url: whatsappLink(summaryText) } : null,
    posts,
  };
}

function autoTask(snapshot, kind) {
  for (const section of snapshot.sections) {
    const task = section.tasks.find((t) => t.auto === kind);
    if (task) return task;
  }
  return null;
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

  router.get('/:date', requireAuth(), ah(async (req, res) => {
    const db = req.app.locals.db;
    const { date } = req.params;
    const user = await targetUser(req);
    // Abrir a tela de hoje já congela o snapshot (brief 7.2).
    if (req.user.role === 'employee' && date === today(req) && isWorkday(await getSettings(db), date)) {
      await ensureDay(db, user.id, date);
    }
    res.json(await payload(req, user, date));
  }));

  // Daqui para baixo, só a funcionária e só no dia de hoje: o passado é imutável (brief 7.6).
  const writable = [
    ...requireRole('employee'),
    ah(async (req, res, next) => {
      const db = req.app.locals.db;
      if (req.params.date !== today(req)) {
        return sendError(res, 409, 'not_today', 'Só é possível registrar o dia de hoje.');
      }
      if (!isWorkday(await getSettings(db), req.params.date)) {
        return sendError(res, 409, 'no_workday', 'Hoje não há expediente.');
      }
      req.day = await ensureDay(db, req.user.id, req.params.date);
      if (req.day.closed_at) return sendError(res, 409, 'day_closed', 'O dia já foi fechado.');
      req.snapshot = JSON.parse(req.day.snapshot);
      next();
    }),
  ];

  // Com a etiqueta exigida, entrada e saída só valem com o código gravado nela. Código enviado errado é sempre recusado.
  const nfcGate = ah(async (req, res, next) => {
    const db = req.app.locals.db;
    const token = req.body?.nfc_token;
    if (token != null && !(await checkNfcToken(db, token))) {
      return sendError(res, 409, 'nfc_invalid', 'Esta etiqueta não é a da loja ou foi trocada. Fale com a gestora.');
    }
    if (token == null && (await isNfcRequired(db))) {
      return sendError(res, 409, 'nfc_required', 'Encoste o celular na etiqueta da loja para registrar o ponto.');
    }
    next();
  });

  /** Grava o horário no dia e marca a tarefa automática correspondente, numa transação só. */
  async function stamp(req, column, kind) {
    const at = nowISO(req.app.locals.now());
    const task = autoTask(req.snapshot, kind);
    await req.app.locals.db.batch([
      [`UPDATE day_records SET ${column} = ? WHERE id = ?`, [at, req.day.id]],
      ...(task ? [['INSERT OR IGNORE INTO task_checks (day_id, task_id, done_at) VALUES (?, ?, ?)', [req.day.id, task.id, at]]] : []),
    ]);
  }

  router.post('/:date/checkin', writable, nfcGate, ah(async (req, res) => {
    if (req.day.check_in_at) return sendError(res, 409, 'already_checked_in', 'A entrada já foi registrada.');
    await stamp(req, 'check_in_at', 'check_in');
    res.json(await payload(req, req.user, req.params.date));
  }));

  router.post('/:date/checkout', writable, nfcGate, ah(async (req, res) => {
    if (!req.day.check_in_at) return sendError(res, 409, 'not_checked_in', 'Registre a entrada antes da saída.');
    if (req.day.check_out_at) return sendError(res, 409, 'already_checked_out', 'A saída já foi registrada.');
    await stamp(req, 'check_out_at', 'check_out');
    res.json(await payload(req, req.user, req.params.date));
  }));

  router.post('/:date/close', writable, ah(async (req, res) => {
    if (!req.day.check_out_at) return sendError(res, 409, 'not_checked_out', 'Registre a saída antes de fechar o dia.');
    await stamp(req, 'closed_at', 'close');
    res.json(await payload(req, req.user, req.params.date));
  }));

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

  function findCheck(db, dayId, taskId) {
    return db.get('SELECT * FROM task_checks WHERE day_id = ? AND task_id = ?', [dayId, taskId]);
  }

  router.put('/:date/tasks/:taskId', writable, ah(async (req, res) => {
    const task = manualTask(req, res);
    if (!task) return;
    const db = req.app.locals.db;
    if (task.requires_photo && !(await findCheck(db, req.day.id, task.id))?.photo_path) {
      return sendError(res, 409, 'photo_required', 'Esta tarefa só é marcada com a foto. Use o botão "Tirar foto".');
    }
    await markTask(db, req.day.id, task.id, nowISO(req.app.locals.now()));
    res.json(await payload(req, req.user, req.params.date));
  }));

  router.delete('/:date/tasks/:taskId', writable, ah(async (req, res) => {
    const task = manualTask(req, res);
    if (!task) return;
    const db = req.app.locals.db;
    const check = await findCheck(db, req.day.id, task.id);
    if (check) {
      await db.run('DELETE FROM task_checks WHERE id = ?', [check.id]);
      if (check.photo_path) await req.app.locals.photos.remove(check.photo_path);
    }
    res.json(await payload(req, req.user, req.params.date));
  }));

  // Enviar a foto marca a tarefa. Uma nova foto substitui a anterior.
  router.post('/:date/tasks/:taskId/photo', writable, receivePhoto, ah(async (req, res) => {
    const task = manualTask(req, res);
    if (!task) return;
    const db = req.app.locals.db;
    const { photos } = req.app.locals;
    const ref = await photos.save(req.params.date, req.file.buffer, req.photoType);
    const existing = await findCheck(db, req.day.id, task.id);
    if (existing) {
      await db.run('UPDATE task_checks SET photo_path = ? WHERE id = ?', [ref, existing.id]);
      if (existing.photo_path) await photos.remove(existing.photo_path);
    } else {
      await db.run('INSERT INTO task_checks (day_id, task_id, done_at, photo_path) VALUES (?, ?, ?, ?)', [
        req.day.id, task.id, nowISO(req.app.locals.now()), ref,
      ]);
    }
    res.json(await payload(req, req.user, req.params.date));
  }));

  // Foto servida só com sessão: a funcionária vê as próprias, a gestora vê todas.
  router.get('/:date/tasks/:taskId/photo', requireAuth(), ah(async (req, res) => {
    const db = req.app.locals.db;
    const user = await targetUser(req);
    const day = user && (await getDay(db, user.id, req.params.date));
    const check = day && (await findCheck(db, day.id, req.taskId));
    res.set('Cache-Control', 'private, max-age=86400');
    const sent = check?.photo_path ? await req.app.locals.photos.send(res, check.photo_path) : false;
    if (!sent && !res.headersSent) sendError(res, 404, 'photo_not_found', 'Foto não encontrada.');
  }));

  return router;
}
