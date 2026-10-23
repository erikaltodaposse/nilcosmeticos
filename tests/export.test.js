import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { scenario } from './scenario.js';
import { makeApp, MANAGER, SECRET, freshDb } from './helpers.js';
import { createApp } from '../server/app.js';
import { CSV_HEADER, restoreBackup } from '../server/lib/export.js';

test('exportação CSV tem BOM e cabeçalho correto', async () => {
  const { manager } = await scenario();
  const res = await manager.get('/api/manager/export.csv?from=2026-10-26&to=2026-10-30').buffer(true).parse((r, cb) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^text\/csv; charset=utf-8/);
  assert.match(res.headers['content-disposition'], /attachment; filename="checkpoint-2026-10-26-a-2026-10-30\.csv"/);
  const raw = res.body;
  assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const lines = raw.toString('utf8').slice(1).trim().split('\r\n');
  assert.equal(lines[0], CSV_HEADER.join(';'));
  assert.equal(lines[0], 'data;dia_semana;funcionaria;entrada;saida;saida_apos_tolerancia;fechado_as;pontos;meta;percentual_meta;tarefas_cumpridas;tarefas_total;fotos;pendentes');
  assert.equal(lines.length, 5); // cabeçalho + 4 dias
  assert.equal(lines[1], '26/10/2026;segunda;Ana;13:00;18:05;não;18:05;150;150;100;12;12;2;');
  assert.equal(lines[3], '28/10/2026;quarta;Ana;13:00;18:20;sim;;125;150;83,3;10;12;1;Limpeza final: hall e entrada | Fechar o dia no app e enviar o resumo');
});

test('backup restaurado em banco limpo reproduz os mesmos números', async () => {
  const { manager } = await scenario();
  const backup = (await manager.get('/api/manager/backup.json').expect(200)).body;
  assert.equal(backup.format, 'checkpoint-nil-backup');
  assert.equal(backup.tables.sessions, undefined);
  assert.ok(backup.tables.day_records.length === 5);

  const queries = ['summary?from=2026-10-26&to=2026-11-02', 'failures', 'days', 'export.csv'];
  const before = {};
  for (const q of queries) before[q] = (await manager.get(`/api/manager/${q}`)).text;

  // Banco novo, sem seed: só migrações + restauração.
  const { db } = await freshDb();
  const counts = await restoreBackup(db, JSON.parse(JSON.stringify(backup)));
  assert.equal(counts.task_checks, backup.tables.task_checks.length);
  const fresh = createApp({ db, sessionSecret: SECRET, secureCookies: false, now: () => new Date('2026-11-02T18:00:00Z') });
  const agent = request.agent(fresh);
  await agent.post('/api/auth/login/password').send(MANAGER).expect(200);
  for (const q of queries) {
    assert.equal((await agent.get(`/api/manager/${q}`)).text, before[q], q);
  }
  // A funcionária entra com o PIN que tinha antes do backup.
  await request(fresh).post('/api/auth/login/pin').send({ pin: '4321' }).expect(200);

  await assert.rejects(() => restoreBackup(db, backup), /já tem dados/);
  await assert.rejects(async () => restoreBackup((await freshDb()).db, { format: 'outro' }), /não é um backup/);
});

test('funcionária não exporta', async () => {
  const { employee } = await scenario();
  await employee.get('/api/manager/export.csv').expect(403);
  await employee.get('/api/manager/backup.json').expect(403);
});

test('CSV vazio ainda traz o cabeçalho', async () => {
  const { app } = await makeApp();
  const m = request.agent(app);
  await m.post('/api/auth/login/password').send(MANAGER).expect(200);
  const res = await m.get('/api/manager/export.csv').expect(200);
  assert.equal(res.text.replace(/^\uFEFF/, '').trim(), CSV_HEADER.join(';'));
});
