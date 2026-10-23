import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scenario } from './scenario.js';
import { failureRanking, taskKey } from '../server/lib/report.js';
import { buildSnapshot } from '../server/lib/snapshot.js';

// Pontos calculados direto no banco, pelo snapshot de cada dia, sem passar pelo código do painel.
// A tarefa de postagens incompleta rende a parte proporcional às postagens feitas.
async function pointsFromDb(db) {
  const partial = await db.all(
    `SELECT d.date, json_extract(t.value, '$.points') AS points, json_array_length(t.value, '$.posts') AS n,
            (SELECT COUNT(*) FROM post_checks pc WHERE pc.day_id = d.id) AS done
     FROM day_records d
     JOIN json_each(d.snapshot, '$.sections') s
     JOIN json_each(s.value, '$.tasks') t
     WHERE json_array_length(t.value, '$.posts') > 0
       AND NOT EXISTS (SELECT 1 FROM task_checks c WHERE c.day_id = d.id AND c.task_id = json_extract(t.value, '$.id'))`,
  );
  const extra = new Map(partial.map((r) => [r.date, Math.floor((r.points * r.done) / r.n)]));
  const rows = await db.all(
      `SELECT d.date, COALESCE(SUM(json_extract(t.value, '$.points')), 0) AS points
       FROM day_records d
       JOIN json_each(d.snapshot, '$.sections') s
       JOIN json_each(s.value, '$.tasks') t
       JOIN task_checks c ON c.day_id = d.id AND c.task_id = json_extract(t.value, '$.id')
       GROUP BY d.date ORDER BY d.date`,
  );
  return rows.map((r) => ({ ...r, points: r.points + (extra.get(r.date) ?? 0) }));
}

test('resumo do período bate com o banco', async () => {
  const { manager, db } = await scenario();
  const fromDb = await pointsFromDb(db);
  assert.deepEqual(fromDb.map((r) => r.points), [150, 120, 125, 120, 10]);

  const res = await manager.get('/api/manager/summary?from=2026-10-26&to=2026-11-02').expect(200);
  const s = res.body.summary;
  const closedPeriod = fromDb.filter((r) => r.date < '2026-11-02');
  const total = closedPeriod.reduce((sum, r) => sum + r.points, 0);
  assert.equal(s.worked_days, 4);
  assert.equal(s.total_points, total);
  assert.equal(s.total_points, 515);
  assert.equal(s.adherence, 515 / 600);
  assert.equal(s.tier.id, 'bronze');
  assert.equal(s.bonus_value, 100);
  assert.equal(s.average_points, 128.8);
  assert.equal(s.late_checkouts, 1);
  assert.equal(s.not_closed, 1);
  assert.equal(s.missing_workdays, 1);
  assert.deepEqual(s.series.map((d) => d.points), [150, 120, 125, 120]);
  assert.deepEqual(s.tasks, { done: 42, total: 48 });
  assert.ok(s.punctuality.timed > 0);
});

test('ranking aponta a tarefa mais falha', async () => {
  const { manager } = await scenario();
  const res = await manager.get('/api/manager/failures?from=2026-10-26').expect(200);
  const [first, ...rest] = res.body.failures;
  assert.equal(first.task, 'Limpeza final: hall e entrada');
  assert.equal(first.missed, 3);
  assert.equal(first.offered, 4);
  assert.deepEqual(first.missed_dates, ['2026-10-27', '2026-10-28', '2026-10-30']);
  assert.ok(rest.every((f) => f.missed === 1));
  assert.deepEqual(rest.map((f) => f.task).sort(), [
    'Fechar o dia no app e enviar o resumo',
    'Postagens do dia',
    'Reposição e organização de gôndolas (15 min)',
  ]);
});

test('histórico lista os dias com situação, e o filtro de período funciona', async () => {
  const { manager } = await scenario();
  const all = await manager.get('/api/manager/days').expect(200);
  assert.deepEqual(all.body.days.map((d) => [d.date, d.status, d.points]), [
    ['2026-11-02', 'em_andamento', 10],
    ['2026-10-30', 'fechado', 120],
    ['2026-10-28', 'sem_fechamento', 125],
    ['2026-10-27', 'fechado', 120],
    ['2026-10-26', 'fechado', 150],
  ]);
  const wed = all.body.days.find((d) => d.date === '2026-10-28');
  assert.equal(wed.late_checkout, true);
  assert.equal(wed.photos, 1);
  assert.equal(wed.photo_tasks, 2);

  const week = await manager.get('/api/manager/days?from=2026-10-27&to=2026-10-28').expect(200);
  assert.equal(week.body.days.length, 2);
  await manager.get('/api/manager/days?from=2026-10-30&to=2026-10-01').expect(400);
  await manager.get('/api/manager/summary?from=ontem').expect(400);
});

test('gestora abre o dia com fotos; funcionária não acessa o painel', async () => {
  const { manager, employee } = await scenario();
  const day = await manager.get('/api/day/2026-10-26').expect(200);
  const withPhoto = day.body.day.sections.flatMap((s) => s.tasks).filter((t) => t.has_photo);
  assert.equal(withPhoto.length, 2);
  await manager.get(`/api/day/2026-10-26/tasks/${withPhoto[0].id}/photo`).expect(200);
  await employee.get('/api/manager/summary').expect(403);
  await employee.get('/api/manager/failures').expect(403);
});

test('mesma tarefa com focos diferentes conta como uma só no ranking', async () => {
  const template = (focus) => ({
    weekday: 1,
    cleaning_focus: focus,
    sections: [{ title: 'Salão', tasks: [{ id: 1, text: 'Limpeza do foco do dia: {foco}', points: 20 }, { id: 2, text: 'Limpeza final: hall e entrada', points: 20 }] }],
  });
  const rows = [
    { date: '2026-10-26', closed_at: 'x', snapshot: buildSnapshot(template('hall principal e entrada')), checks: [{ task_id: 2 }] },
    { date: '2026-10-29', closed_at: 'x', snapshot: buildSnapshot(template('hall e entrada')), checks: [{ task_id: 2 }] },
  ];
  const ranking = failureRanking(rows, '2026-11-01');
  assert.equal(ranking.length, 1);
  assert.equal(ranking[0].task, 'Limpeza do foco do dia');
  assert.equal(ranking[0].missed, 2);
  assert.equal(taskKey(rows[1].snapshot.sections[0].tasks[1]), 'Limpeza final: hall e entrada');
});
