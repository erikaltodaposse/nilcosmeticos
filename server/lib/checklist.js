// Acesso ao banco para checklist, configurações e registros do dia.
import { buildSnapshot, canRewriteSnapshot, postsTask, snapshotPost } from './snapshot.js';
import { dayPoints } from './points.js';
import { nowISO, weekdayOf, timeKey, minutesOf } from './date.js';

export const CHECKOUT_TOLERANCE_MIN = 10;
// Tarefa (ou postagem) feita mais de 15 minutos depois do horário conta como atrasada. Não perde pontos.
export const TASK_TOLERANCE_MIN = 15;

export async function getSettings(db) {
  const rows = await db.all('SELECT key, value FROM settings');
  const raw = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    raw,
    meta: Number(raw.meta_pontos) || 150,
    shiftStart: raw.turno_inicio || '13:00',
    shiftEnd: raw.turno_fim || '18:00',
    storeName: raw.nome_loja || 'Nil Cosméticos',
    brandStyle: raw.estilo_marca ?? '',
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
export async function loadTemplate(db, weekday) {
  const version = await db.get(
    'SELECT * FROM checklist_versions WHERE weekday = ? AND active = 1 ORDER BY version DESC LIMIT 1',
    [weekday],
  );
  if (!version) return null;
  const sections = await db.all('SELECT * FROM checklist_sections WHERE version_id = ? ORDER BY position, id', [version.id]);
  const tasks = await db.all(
    `SELECT t.* FROM checklist_tasks t JOIN checklist_sections s ON s.id = t.section_id
     WHERE s.version_id = ? AND t.active = 1 ORDER BY t.position, t.id`,
    [version.id],
  );
  return {
    version_id: version.id,
    version: version.version,
    weekday,
    cleaning_focus: version.cleaning_focus,
    sections: sections.map((s) => ({
      title: s.title,
      subtitle: s.subtitle,
      tasks: tasks.filter((t) => t.section_id === s.id),
    })),
  };
}

/** Roteiro da data: as postagens programadas para ela ou, sem nenhuma, as do dia da semana. */
export async function loadPostsFor(db, date) {
  const cols = 'id, time, kind, goal, image_prompt, text_prompt';
  const dated = await db.all(`SELECT ${cols} FROM posts WHERE date = ? AND active = 1 ORDER BY time, id`, [date]);
  if (dated.length) return dated;
  return db.all(`SELECT ${cols} FROM posts WHERE date IS NULL AND weekday = ? AND active = 1 ORDER BY time, id`, [weekdayOf(date)]);
}

/**
 * Salva um novo template para o dia da semana como nova versão. Dias já registrados não mudam;
 * o dia de hoje, se estiver vazio, recebe o snapshot novo (brief 7.2).
 * `data` = { cleaning_focus, sections: [{ title, subtitle, tasks: [{ text, points, requires_photo, auto, due_time, posts }] }] }.
 */
export async function createChecklistVersion(db, weekday, data, today) {
  return db.transaction(async (tx) => {
    const now = nowISO();
    const last = (await tx.get('SELECT MAX(version) AS v FROM checklist_versions WHERE weekday = ?', [weekday])).v ?? 0;
    await tx.run('UPDATE checklist_versions SET active = 0 WHERE weekday = ?', [weekday]);
    const versionId = (await tx.run(
      'INSERT INTO checklist_versions (weekday, version, cleaning_focus, active, created_at) VALUES (?, ?, ?, 1, ?)',
      [weekday, last + 1, data.cleaning_focus ?? null, now],
    )).lastInsertRowid;
    for (const [sIdx, section] of data.sections.entries()) {
      const sectionId = (await tx.run(
        'INSERT INTO checklist_sections (version_id, position, title, subtitle) VALUES (?, ?, ?, ?)',
        [versionId, sIdx, section.title, section.subtitle ?? null],
      )).lastInsertRowid;
      for (const [tIdx, task] of section.tasks.entries()) {
        await tx.run(
          `INSERT INTO checklist_tasks (section_id, position, text, points, requires_photo, auto, due_time, posts)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [sectionId, tIdx, task.text, task.points, task.requires_photo ? 1 : 0, task.auto ?? null, task.due_time ?? null, task.posts ? 1 : 0],
        );
      }
    }

    if (weekdayOf(today) === weekday) {
      const snapshot = JSON.stringify(buildSnapshot(await loadTemplate(tx, weekday), await loadPostsFor(tx, today)));
      for (const day of await tx.all('SELECT * FROM day_records WHERE date = ?', [today])) {
        if (canRewriteSnapshot(day, await getChecks(tx, day.id), today, await getPostChecks(tx, day.id))) {
          await tx.run('UPDATE day_records SET snapshot = ? WHERE id = ?', [snapshot, day.id]);
        }
      }
    }
    return versionId;
  });
}

export async function getDay(db, userId, date) {
  return db.get('SELECT * FROM day_records WHERE user_id = ? AND date = ?', [userId, date]);
}

export async function getChecks(db, dayId) {
  return db.all('SELECT * FROM task_checks WHERE day_id = ? ORDER BY done_at', [dayId]);
}

export async function getPostChecks(db, dayId) {
  return db.all('SELECT * FROM post_checks WHERE day_id = ? ORDER BY done_at', [dayId]);
}

/**
 * Depois de editar o roteiro: o dia de hoje que ainda não tem nenhuma postagem marcada passa a usar o roteiro novo.
 * O resto do snapshot não muda.
 */
export async function refreshTodayPosts(db, today) {
  const posts = (await loadPostsFor(db, today)).map(snapshotPost);
  for (const day of await db.all('SELECT * FROM day_records WHERE date = ? AND closed_at IS NULL', [today])) {
    if ((await getPostChecks(db, day.id)).length) continue;
    const snapshot = JSON.parse(day.snapshot);
    const task = postsTask(snapshot);
    if (!task) continue;
    task.posts = posts;
    await db.run('UPDATE day_records SET snapshot = ? WHERE id = ?', [JSON.stringify(snapshot), day.id]);
  }
}

/** A tarefa de postagens fica marcada quando todas as postagens estão feitas, com o horário da última. */
export async function syncPostsTask(db, dayId, task) {
  const ids = new Set(task.posts.map((p) => p.id));
  const done = (await getPostChecks(db, dayId)).filter((c) => ids.has(c.post_id));
  if (done.length === ids.size) {
    await markTask(db, dayId, task.id, done[done.length - 1].done_at);
  } else {
    await db.run('DELETE FROM task_checks WHERE day_id = ? AND task_id = ?', [dayId, task.id]);
  }
}

/** Devolve o registro do dia, criando-o e congelando o snapshot se ainda não existir. */
export async function ensureDay(db, userId, date) {
  const existing = await getDay(db, userId, date);
  if (existing) return existing;
  const template = await loadTemplate(db, weekdayOf(date));
  if (!template) throw Object.assign(new Error('Não há checklist para este dia da semana.'), { status: 409, code: 'no_checklist' });
  await db.run('INSERT OR IGNORE INTO day_records (user_id, date, snapshot, created_at) VALUES (?, ?, ?, ?)', [
    userId,
    date,
    JSON.stringify(buildSnapshot(template, await loadPostsFor(db, date))),
    nowISO(),
  ]);
  return getDay(db, userId, date);
}

export async function markTask(db, dayId, taskId, at = nowISO()) {
  await db.run('INSERT OR IGNORE INTO task_checks (day_id, task_id, done_at) VALUES (?, ?, ?)', [dayId, taskId, at]);
}

/** Saída depois do fim do turno + tolerância. */
export function isLateCheckout(checkOutAt, settings) {
  if (!checkOutAt) return false;
  return minutesOf(timeKey(new Date(checkOutAt))) > minutesOf(settings.shiftEnd) + CHECKOUT_TOLERANCE_MIN;
}

/** Feita mais de TASK_TOLERANCE_MIN minutos depois do horário previsto. */
export function isLateDone(dueTime, doneAt) {
  if (!dueTime || !doneAt) return false;
  return minutesOf(timeKey(new Date(doneAt))) > minutesOf(dueTime) + TASK_TOLERANCE_MIN;
}

/** Prompt de imagem com o estilo da marca no fim. */
export function fullImagePrompt(prompt, brandStyle) {
  if (!prompt) return null;
  return brandStyle ? `${prompt}\n\n${brandStyle}` : prompt;
}

/** Visão do dia para a API: snapshot com estado de cada tarefa e pontos. */
export async function dayView(db, day, settings) {
  const snapshot = JSON.parse(day.snapshot);
  const checks = await getChecks(db, day.id);
  const postChecks = await getPostChecks(db, day.id);
  const byTask = new Map(checks.map((c) => [c.task_id, c]));
  const byPost = new Map(postChecks.map((c) => [c.post_id, c]));
  const postView = (post) => {
    const check = byPost.get(post.id);
    return {
      ...post,
      image_prompt_full: fullImagePrompt(post.image_prompt, settings.brandStyle),
      done: Boolean(check),
      done_at: check?.done_at ?? null,
      late: isLateDone(post.time, check?.done_at),
    };
  };
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
        return {
          ...task,
          done: Boolean(check),
          done_at: check?.done_at ?? null,
          late: isLateDone(task.due_time, check?.done_at),
          has_photo: Boolean(check?.photo_path),
          ...(task.posts ? { posts: task.posts.map(postView) } : {}),
        };
      }),
    })),
    points: { ...dayPoints(snapshot, checks.map((c) => c.task_id), postChecks.map((c) => c.post_id)), meta: settings.meta },
  };
}
