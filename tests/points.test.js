import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, snapshotTasks } from '../server/lib/snapshot.js';
import { dayPoints, adherence, bonusTier } from '../server/lib/points.js';
import { DEFAULT_SECTIONS } from '../server/lib/defaults.js';

function defaultTemplate() {
  let id = 0;
  return {
    version_id: 1,
    weekday: 1,
    cleaning_focus: 'hall principal e entrada',
    sections: DEFAULT_SECTIONS.map((s) => ({ ...s, tasks: s.tasks.map((t) => ({ ...t, id: ++id })) })),
  };
}

test('as 14 tarefas padrão somam 150', () => {
  const snap = buildSnapshot(defaultTemplate());
  const ids = snapshotTasks(snap).map((t) => t.id);
  assert.equal(ids.length, 14);
  assert.deepEqual(dayPoints(snap, ids), { earned: 150, max: 150, done: 14, total: 14 });
});

test('dia parcial soma só o que foi marcado', () => {
  const snap = buildSnapshot(defaultTemplate());
  // 1: ponto de entrada (10), 3: Boa tarde (15), 5: limpeza do foco (20)
  assert.deepEqual(dayPoints(snap, [1, 3, 5]), { earned: 45, max: 150, done: 3, total: 14 });
  assert.equal(dayPoints(snap, []).earned, 0);
});

test('tarefa removida do template não afeta dia antigo', () => {
  const template = defaultTemplate();
  const oldDay = buildSnapshot(template);
  const allIds = snapshotTasks(oldDay).map((t) => t.id);

  template.sections[1].tasks.shift(); // remove a limpeza do foco
  const newDay = buildSnapshot(template);

  assert.equal(dayPoints(oldDay, allIds).earned, 150);
  assert.equal(dayPoints(newDay, allIds).max, 130);
});

test('foco do dia entra no texto da tarefa', () => {
  const snap = buildSnapshot(defaultTemplate());
  assert.equal(snap.sections[1].tasks[0].text, 'Limpeza do foco do dia: hall principal e entrada');
});

test('adesão ignora dias sem check e aplica as faixas', () => {
  const a = adherence(
    [
      { points: 150, checks: 14 },
      { points: 135, checks: 12 },
      { points: 0, checks: 0 },
    ],
    150,
  );
  assert.equal(a.workedDays, 2);
  assert.equal(a.ratio, 285 / 300);
  assert.equal(bonusTier(a.ratio).id, 'ouro');
  assert.equal(bonusTier(0.94).id, 'prata');
  assert.equal(bonusTier(0.88).id, 'prata');
  assert.equal(bonusTier(0.879).id, 'bronze');
  assert.equal(bonusTier(0.8).id, 'bronze');
  assert.equal(bonusTier(0.79).id, 'abaixo');
  assert.equal(adherence([], 150).ratio, null);
  assert.equal(bonusTier(null), null);
});
