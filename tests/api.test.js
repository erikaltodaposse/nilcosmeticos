import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, MANAGER } from './helpers.js';
import { seed } from '../server/seed.js';

async function loginEmployee(agent, pin = '1234') {
  return agent.post('/api/auth/login/pin').send({ pin });
}

test('rota protegida devolve 401 sem sessão', async () => {
  const { app } = makeApp();
  const res = await request(app).get('/api/me');
  assert.equal(res.status, 401);
  assert.deepEqual(Object.keys(res.body).sort(), ['error', 'message']);
  assert.equal(res.body.error, 'unauthenticated');
});

test('login inválido barra', async () => {
  const { app } = makeApp();
  const pin = await request(app).post('/api/auth/login/pin').send({ pin: '9999' });
  assert.equal(pin.status, 401);
  assert.equal(pin.headers['set-cookie'], undefined);

  const pwd = await request(app)
    .post('/api/auth/login/password')
    .send({ email: MANAGER.email, password: 'errada' });
  assert.equal(pwd.status, 401);

  const fmt = await request(app).post('/api/auth/login/pin').send({ pin: '12' });
  assert.equal(fmt.status, 400);
});

test('gestora entra com e-mail e senha e /api/me responde', async () => {
  const { app } = makeApp();
  const agent = request.agent(app);
  const login = await agent
    .post('/api/auth/login/password')
    .send({ email: MANAGER.email.toUpperCase(), password: MANAGER.password });
  assert.equal(login.status, 200);
  const cookie = login.headers['set-cookie'][0];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);

  const me = await agent.get('/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.role, 'manager');

  await agent.post('/api/auth/logout').expect(200);
  await agent.get('/api/me').expect(401);
});

test('funcionária entra com PIN 1234 e precisa trocar antes de seguir', async () => {
  const { app } = makeApp();
  const agent = request.agent(app);
  const login = await loginEmployee(agent);
  assert.equal(login.status, 200);
  assert.equal(login.body.user.must_change_pin, true);

  const me = await agent.get('/api/me');
  assert.equal(me.status, 200);

  const blocked = await agent.get('/api/manager/settings');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error, 'pin_change_required');

  const bad = await agent.post('/api/auth/change-pin').send({ current_pin: '0000', new_pin: '4321' });
  assert.equal(bad.status, 400);

  const ok = await agent.post('/api/auth/change-pin').send({ current_pin: '1234', new_pin: '4321' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.must_change_pin, false);

  await agent.post('/api/auth/logout').expect(200);
  await loginEmployee(agent, '1234').then((r) => assert.equal(r.status, 401));
  await loginEmployee(agent, '4321').then((r) => assert.equal(r.status, 200));
});

test('employee não acessa rota de manager', async () => {
  const { app } = makeApp();
  const agent = request.agent(app);
  await loginEmployee(agent);
  await agent.post('/api/auth/change-pin').send({ current_pin: '1234', new_pin: '4321' }).expect(200);

  const res = await agent.get('/api/manager/settings');
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'forbidden');
});

test('gestora lê as configurações semeadas', async () => {
  const { app } = makeApp();
  const agent = request.agent(app);
  await agent.post('/api/auth/login/password').send(MANAGER).expect(200);
  const res = await agent.get('/api/manager/settings');
  assert.equal(res.status, 200);
  assert.equal(res.body.settings.meta_pontos, '150');
});

test('login bloqueia após 5 tentativas erradas', async () => {
  const { app } = makeApp();
  for (let i = 0; i < 5; i++) {
    await request(app).post('/api/auth/login/pin').send({ pin: '0000' }).expect(401);
  }
  const res = await request(app).post('/api/auth/login/pin').send({ pin: '1234' });
  assert.equal(res.status, 429);
  assert.equal(res.body.error, 'too_many_attempts');
});

test('seed é idempotente e cria checklist de 150 pontos para cada dia', () => {
  const { db } = makeApp();
  const again = seed(db, { MANAGER_EMAIL: MANAGER.email, MANAGER_PASSWORD: MANAGER.password });
  assert.deepEqual(again, { manager: false, employee: false, settings: 0, checklist: false });
  const totals = db
    .prepare(
      `SELECT v.weekday, SUM(t.points) AS total, COUNT(*) AS n FROM checklist_tasks t
       JOIN checklist_sections s ON s.id = t.section_id
       JOIN checklist_versions v ON v.id = s.version_id GROUP BY v.weekday`,
    )
    .all();
  assert.equal(totals.length, 7);
  for (const row of totals) {
    assert.equal(row.total, 150);
    assert.equal(row.n, 14);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 2);
});

test('API desconhecida devolve 404 em JSON', async () => {
  const { app } = makeApp();
  const res = await request(app).get('/api/nada');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'not_found');
});
