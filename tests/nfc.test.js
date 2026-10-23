import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, MANAGER, MONDAY, employeeAgent } from './helpers.js';

async function managerAgent(app) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login/password').send(MANAGER).expect(200);
  return agent;
}

const tokenOf = (path) => path.split('/').pop();

test('gestora vê o link da etiqueta e o ponto comum continua valendo enquanto não exige', async () => {
  const { app } = makeApp();
  const m = await managerAgent(app);
  const nfc = await m.get('/api/manager/nfc').expect(200);
  assert.match(nfc.body.path, /^\/ponto\/[A-Za-z0-9_-]{32}$/);
  assert.equal(nfc.body.required, false);
  assert.equal((await m.get('/api/manager/nfc')).body.path, nfc.body.path);

  const e = await employeeAgent(app, request);
  const day = await e.post(`/api/day/${MONDAY}/checkin`).expect(200);
  assert.equal(day.body.settings.nfc_required, false);
});

test('com a etiqueta exigida, entrada e saída só valem com o código certo', async () => {
  const { app, clock } = makeApp();
  const m = await managerAgent(app);
  const token = tokenOf((await m.get('/api/manager/nfc')).body.path);
  const saved = await m.put('/api/manager/settings').send({ ponto_exige_nfc: true }).expect(200);
  assert.equal(saved.body.settings.ponto_exige_nfc, true);

  const e = await employeeAgent(app, request);
  const plain = await e.post(`/api/day/${MONDAY}/checkin`);
  assert.equal(plain.status, 409);
  assert.equal(plain.body.error, 'nfc_required');

  const wrong = await e.post(`/api/day/${MONDAY}/checkin`).send({ nfc_token: 'x'.repeat(32) });
  assert.equal(wrong.status, 409);
  assert.equal(wrong.body.error, 'nfc_invalid');

  const ok = await e.post(`/api/day/${MONDAY}/checkin`).send({ nfc_token: token }).expect(200);
  assert.equal(ok.body.settings.nfc_required, true);
  assert.ok(ok.body.day.check_in_at);

  clock.now = new Date('2026-10-26T22:02:00Z');
  await e.post(`/api/day/${MONDAY}/checkout`).expect(409);
  await e.post(`/api/day/${MONDAY}/checkout`).send({ nfc_token: token }).expect(200);
});

test('gerar novo código invalida a etiqueta antiga', async () => {
  const { app, db } = makeApp();
  const m = await managerAgent(app);
  const old = tokenOf((await m.get('/api/manager/nfc')).body.path);
  const fresh = tokenOf((await m.post('/api/manager/nfc/rotate').expect(200)).body.path);
  assert.notEqual(old, fresh);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'nfc.rotate'").get().n, 1);

  const e = await employeeAgent(app, request);
  const res = await e.post(`/api/day/${MONDAY}/checkin`).send({ nfc_token: old });
  assert.equal(res.body.error, 'nfc_invalid');
  await e.post(`/api/day/${MONDAY}/checkin`).send({ nfc_token: fresh }).expect(200);
});

test('link da etiqueta abre o app; funcionária não vê o código', async () => {
  const { app } = makeApp();
  const page = await request(app).get('/ponto/abcdefghijklmnopqrstuvwxyz012345').expect(200);
  assert.match(page.text, /<main id="app"/);
  assert.equal(page.headers['cache-control'], 'no-store');

  const e = await employeeAgent(app, request);
  await e.get('/api/manager/nfc').expect(403);
  await e.post('/api/manager/nfc/rotate').expect(403);
  await (await managerAgent(app)).put('/api/manager/settings').send({ ponto_exige_nfc: 'sim' }).expect(400);
});
