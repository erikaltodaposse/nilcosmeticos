import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dateKey, todayKey, isDateKey, weekdayOf } from '../server/lib/date.js';

test('dateKey usa o fuso de Manaus, não UTC', async () => {
  // 02:30 UTC de 24/10 ainda é 22:30 de 23/10 em Manaus (UTC-4).
  assert.equal(dateKey(new Date('2026-10-24T02:30:00Z')), '2026-10-23');
  assert.equal(dateKey(new Date('2026-10-24T04:00:00Z')), '2026-10-24');
  assert.equal(todayKey(new Date('2026-01-01T03:59:59Z')), '2025-12-31');
});

test('isDateKey aceita só datas reais em YYYY-MM-DD', async () => {
  assert.ok(isDateKey('2026-02-28'));
  assert.ok(!isDateKey('2026-02-30'));
  assert.ok(!isDateKey('2026-2-3'));
  assert.ok(!isDateKey(20260203));
});

test('weekdayOf devolve 0 para domingo', async () => {
  assert.equal(weekdayOf('2026-10-25'), 0);
  assert.equal(weekdayOf('2026-10-23'), 5);
});
