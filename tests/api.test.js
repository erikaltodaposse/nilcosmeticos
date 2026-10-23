import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, MANAGER, MONDAY, MONDAY_15H, employeeAgent } from './helpers.js';
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

// ---------- Fase 2: dia e checklist ----------

function allTasks(body) {
  return body.day.sections.flatMap((s) => s.tasks);
}

test('abrir o dia de hoje congela o snapshot', async () => {
  const { app, db } = makeApp();
  const agent = await employeeAgent(app, request);
  const res = await agent.get(`/api/day/${MONDAY}`).expect(200);
  assert.equal(res.body.is_today, true);
  assert.equal(res.body.editable, true);
  assert.equal(res.body.day.points.max, 150);
  assert.equal(allTasks(res.body).length, 14);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM day_records').get().n, 1);
});

test('check-in cria snapshot e marca o ponto de entrada', async () => {
  const { app, db } = makeApp();
  const agent = await employeeAgent(app, request);
  const res = await agent.post(`/api/day/${MONDAY}/checkin`).expect(200);
  assert.equal(res.body.day.check_in_at, MONDAY_15H.toISOString());
  const row = db.prepare('SELECT snapshot FROM day_records').get();
  assert.equal(JSON.parse(row.snapshot).sections.length, 4);
  const entrada = allTasks(res.body).find((t) => t.auto === 'check_in');
  assert.equal(entrada.done, true);
  assert.equal(res.body.day.points.earned, 10);
  await agent.post(`/api/day/${MONDAY}/checkin`).expect(409);
});

test('marcar as 14 tarefas fecha 150 pontos', async () => {
  const { app, clock } = makeApp();
  const agent = await employeeAgent(app, request);
  let res = await agent.post(`/api/day/${MONDAY}/checkin`).expect(200);
  for (const task of allTasks(res.body).filter((t) => !t.auto)) {
    await agent.put(`/api/day/${MONDAY}/tasks/${task.id}`).expect(200);
  }
  clock.now = new Date('2026-10-26T22:05:00Z'); // 18:05 em Manaus
  res = await agent.post(`/api/day/${MONDAY}/checkout`).expect(200);
  assert.equal(res.body.day.late_checkout, false);
  assert.equal(res.body.day.points.earned, 145);

  res = await agent.post(`/api/day/${MONDAY}/close`).expect(200);
  assert.deepEqual(res.body.day.points, { earned: 150, max: 150, done: 14, total: 14, meta: 150 });
  assert.equal(res.body.editable, false);

  const task = allTasks(res.body).find((t) => !t.auto);
  const frozen = await agent.delete(`/api/day/${MONDAY}/tasks/${task.id}`);
  assert.equal(frozen.status, 409);
  assert.equal(frozen.body.error, 'day_closed');
});

test('fechar o dia exige a saída registrada', async () => {
  const { app } = makeApp();
  const agent = await employeeAgent(app, request);
  await agent.post(`/api/day/${MONDAY}/checkin`).expect(200);
  const res = await agent.post(`/api/day/${MONDAY}/close`);
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'not_checked_out');
});

test('desmarcar tira os pontos; tarefa automática não aceita marcação manual', async () => {
  const { app } = makeApp();
  const agent = await employeeAgent(app, request);
  const day = await agent.get(`/api/day/${MONDAY}`).expect(200);
  const boaTarde = allTasks(day.body).find((t) => t.text.startsWith('Postar'));
  let res = await agent.put(`/api/day/${MONDAY}/tasks/${boaTarde.id}`).expect(200);
  assert.equal(res.body.day.points.earned, 15);
  res = await agent.delete(`/api/day/${MONDAY}/tasks/${boaTarde.id}`).expect(200);
  assert.equal(res.body.day.points.earned, 0);

  const auto = allTasks(day.body).find((t) => t.auto === 'check_in');
  const blocked = await agent.put(`/api/day/${MONDAY}/tasks/${auto.id}`);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, 'auto_task');

  await agent.put(`/api/day/${MONDAY}/tasks/99999`).expect(404);
  await agent.put(`/api/day/${MONDAY}/tasks/abc`).expect(400);
});

test('saída depois de 18h10 é sinalizada', async () => {
  const { app, clock } = makeApp();
  const agent = await employeeAgent(app, request);
  await agent.post(`/api/day/${MONDAY}/checkout`).expect(409); // sem entrada
  await agent.post(`/api/day/${MONDAY}/checkin`).expect(200);
  clock.now = new Date('2026-10-26T22:11:00Z'); // 18:11
  const res = await agent.post(`/api/day/${MONDAY}/checkout`).expect(200);
  assert.equal(res.body.day.late_checkout, true);
});

test('dia anterior é imutável e data inválida é recusada', async () => {
  const { app, clock } = makeApp();
  const agent = await employeeAgent(app, request);
  const day = await agent.post(`/api/day/${MONDAY}/checkin`).expect(200);
  const task = allTasks(day.body).find((t) => !t.auto);
  await agent.put(`/api/day/${MONDAY}/tasks/${task.id}`).expect(200);

  clock.now = new Date('2026-10-27T19:00:00Z'); // terça
  const res = await agent.delete(`/api/day/${MONDAY}/tasks/${task.id}`);
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'not_today');
  const past = await agent.get(`/api/day/${MONDAY}`).expect(200);
  assert.equal(past.body.editable, false);
  assert.equal(past.body.day.points.earned, 15);

  await agent.get('/api/day/2026-13-01').expect(400);
});

test('sábado e domingo não têm expediente', async () => {
  const { app, db } = makeApp({ now: new Date('2026-10-24T19:00:00Z') }); // sábado
  const agent = await employeeAgent(app, request);
  const res = await agent.get('/api/day/2026-10-24').expect(200);
  assert.equal(res.body.workday, false);
  assert.equal(res.body.day, null);
  const blocked = await agent.post('/api/day/2026-10-24/checkin');
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, 'no_workday');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM day_records').get().n, 0);
});

test('gestora vê o dia da funcionária, mas não registra', async () => {
  const { app } = makeApp();
  const employee = await employeeAgent(app, request);
  await employee.post(`/api/day/${MONDAY}/checkin`).expect(200);

  const manager = request.agent(app);
  await manager.post('/api/auth/login/password').send(MANAGER).expect(200);
  const res = await manager.get(`/api/day/${MONDAY}`).expect(200);
  assert.equal(res.body.employee.name, 'Ana');
  assert.equal(res.body.editable, false);
  assert.equal(res.body.day.points.earned, 10);
  await manager.post(`/api/day/${MONDAY}/checkout`).expect(403);
});
