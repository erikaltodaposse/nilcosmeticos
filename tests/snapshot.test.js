import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, MONDAY } from './helpers.js';
import { buildSnapshot, isDayEmpty, canRewriteSnapshot } from '../server/lib/snapshot.js';
import { loadTemplate, createChecklistVersion, ensureDay, markTask, getChecks, getDay } from '../server/lib/checklist.js';
import { dayPoints } from '../server/lib/points.js';
import { snapshotTasks } from '../server/lib/snapshot.js';

const MONDAY_WD = 1;

// Template de 400 pontos: as mesmas seções, cada tarefa valendo mais.
function bigTemplate(db) {
  const t = loadTemplate(db, MONDAY_WD);
  return {
    cleaning_focus: t.cleaning_focus,
    sections: [
      ...t.sections.map((s) => ({ ...s, tasks: s.tasks.map((task) => ({ ...task })) })),
      { title: 'Extra', subtitle: null, tasks: [{ text: 'Inventário completo', points: 250 }] },
    ],
  };
}

function pointsOf(db, day) {
  const snapshot = JSON.parse(day.snapshot);
  return dayPoints(snapshot, getChecks(db, day.id).map((c) => c.task_id));
}

function employeeId(db) {
  return db.prepare("SELECT id FROM users WHERE role = 'employee'").get().id;
}

test('dia com snapshot de 150 continua 150 depois de o template virar 400', () => {
  const { db } = makeApp();
  const uid = employeeId(db);
  const day = ensureDay(db, uid, '2026-10-19');
  for (const task of snapshotTasks(JSON.parse(day.snapshot))) markTask(db, day.id, task.id);
  assert.equal(pointsOf(db, day).earned, 150);

  createChecklistVersion(db, MONDAY_WD, bigTemplate(db), MONDAY);
  const template = loadTemplate(db, MONDAY_WD);
  assert.equal(snapshotTasks(buildSnapshot(template)).reduce((s, t) => s + t.points, 0), 400);

  const after = getDay(db, uid, '2026-10-19');
  assert.equal(after.snapshot, day.snapshot);
  assert.deepEqual(pointsOf(db, after), { earned: 150, max: 150, done: 14, total: 14 });
});

test('editar checklist não altera o dia de hoje já registrado', () => {
  const { db } = makeApp();
  const uid = employeeId(db);
  const day = ensureDay(db, uid, MONDAY);
  markTask(db, day.id, snapshotTasks(JSON.parse(day.snapshot))[1].id);

  createChecklistVersion(db, MONDAY_WD, bigTemplate(db), MONDAY);
  assert.equal(getDay(db, uid, MONDAY).snapshot, day.snapshot);
});

test('dia de hoje vazio aceita regravação do snapshot', () => {
  const { db } = makeApp();
  const uid = employeeId(db);
  const day = ensureDay(db, uid, MONDAY);
  assert.equal(pointsOf(db, day).max, 150);

  createChecklistVersion(db, MONDAY_WD, bigTemplate(db), MONDAY);
  assert.equal(pointsOf(db, getDay(db, uid, MONDAY)).max, 400);
});

test('dia anterior vazio não é regravado', () => {
  const { db } = makeApp();
  const uid = employeeId(db);
  const old = ensureDay(db, uid, '2026-10-19');
  createChecklistVersion(db, MONDAY_WD, bigTemplate(db), MONDAY);
  assert.equal(getDay(db, uid, '2026-10-19').snapshot, old.snapshot);
});

test('regras de dia vazio', () => {
  const empty = { date: MONDAY, check_in_at: null, check_out_at: null };
  assert.ok(isDayEmpty(empty, []));
  assert.ok(!isDayEmpty({ ...empty, check_in_at: 'x' }, []));
  assert.ok(!isDayEmpty(empty, [{ task_id: 1 }]));
  assert.ok(canRewriteSnapshot(empty, [], MONDAY));
  assert.ok(!canRewriteSnapshot(empty, [], '2026-10-27'));
});
