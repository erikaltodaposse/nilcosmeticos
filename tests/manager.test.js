import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { makeApp, MANAGER, MONDAY, employeeAgent } from './helpers.js';

async function managerAgent(app) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login/password').send(MANAGER).expect(200);
  return agent;
}

function tasksOf(body) {
  return body.day.sections.flatMap((s) => s.tasks);
}

test('gestora lê o checklist de um dia da semana', async () => {
  const { app } = makeApp();
  const m = await managerAgent(app);
  const res = await m.get('/api/manager/checklist/1').expect(200);
  assert.equal(res.body.checklist.version, 1);
  assert.equal(res.body.checklist.cleaning_focus, 'hall principal e entrada');
  assert.equal(res.body.checklist.sections.length, 4);
  await m.get('/api/manager/checklist/7').expect(400);
});

test('editar e salvar vale para o dia seguinte e não altera o passado', async () => {
  const { app, clock } = makeApp();
  const employee = await employeeAgent(app, request);
  const m = await managerAgent(app);

  // Segunda: funcionária registra o dia com o checklist original.
  await employee.post(`/api/day/${MONDAY}/checkin`).expect(200);

  // Gestora cadastra uma tarefa nova para segunda e terça.
  const { body } = await m.get('/api/manager/checklist/1');
  const checklist = body.checklist;
  checklist.sections[1].tasks.push({ text: 'Conferir validade dos testers', points: 10, requires_photo: false });
  checklist.cleaning_focus = 'hall e provador';
  const saved = await m.put('/api/manager/checklist/1').send({ ...checklist, also_weekdays: [2] }).expect(200);
  assert.deepEqual(saved.body.saved_weekdays, [1, 2]);
  assert.equal(saved.body.checklist.version, 2);

  // O dia de segunda já registrado continua igual.
  const monday = await employee.get(`/api/day/${MONDAY}`).expect(200);
  assert.equal(monday.body.day.points.max, 150);
  assert.ok(!tasksOf(monday.body).some((t) => t.text.includes('testers')));

  // Terça já usa o checklist novo, com o foco de terça preservado.
  clock.now = new Date('2026-10-27T19:00:00Z');
  const tuesday = await employee.get('/api/day/2026-10-27').expect(200);
  assert.equal(tuesday.body.day.points.max, 160);
  assert.ok(tasksOf(tuesday.body).some((t) => t.text === 'Conferir validade dos testers'));
  assert.ok(tasksOf(tuesday.body).some((t) => t.text === 'Limpeza do foco do dia: hall e vitrine'));

  // Segunda seguinte usa o foco novo.
  clock.now = new Date('2026-11-02T19:00:00Z');
  const next = await employee.get('/api/day/2026-11-02').expect(200);
  assert.ok(tasksOf(next.body).some((t) => t.text === 'Limpeza do foco do dia: hall e provador'));
});

test('salvar com o dia de hoje vazio já aplica hoje', async () => {
  const { app } = makeApp();
  const employee = await employeeAgent(app, request);
  const m = await managerAgent(app);
  await employee.get(`/api/day/${MONDAY}`).expect(200); // abre a tela, sem registrar nada
  const { body } = await m.get('/api/manager/checklist/1');
  body.checklist.sections[0].tasks[1].points = 25;
  await m.put('/api/manager/checklist/1').send(body.checklist).expect(200);
  const day = await employee.get(`/api/day/${MONDAY}`).expect(200);
  assert.equal(day.body.day.points.max, 170);
});

test('restaurar padrão volta às 14 tarefas', async () => {
  const { app } = makeApp();
  const m = await managerAgent(app);
  await m
    .put('/api/manager/checklist/3')
    .send({ cleaning_focus: 'x', sections: [{ title: 'Único', tasks: [{ text: 'Uma tarefa', points: 5 }] }] })
    .expect(200);
  const res = await m.post('/api/manager/checklist/3/restore').expect(200);
  const tasks = res.body.checklist.sections.flatMap((s) => s.tasks);
  assert.equal(tasks.length, 14);
  assert.equal(tasks.reduce((s, t) => s + t.points, 0), 150);
  assert.equal(res.body.checklist.cleaning_focus, 'hall e banheiro');
  assert.equal(res.body.checklist.version, 3);
});

test('checklist inválido é recusado com mensagem clara', async () => {
  const { app } = makeApp();
  const m = await managerAgent(app);
  const cases = [
    { sections: [] },
    { sections: [{ title: '', tasks: [{ text: 'a', points: 1 }] }] },
    { sections: [{ title: 'A', tasks: [{ text: '', points: 1 }] }] },
    { sections: [{ title: 'A', tasks: [{ text: 'a', points: -1 }] }] },
    { sections: [{ title: 'A', tasks: [{ text: 'a', points: 1.5 }] }] },
    { sections: [{ title: 'A', tasks: [{ text: 'a', points: 1, post_slot: 4 }] }] },
    { sections: [{ title: 'A', tasks: [{ text: 'a', points: 1, auto: 'close' }, { text: 'b', points: 1, auto: 'close' }] }] },
    { sections: [{ title: 'A', tasks: [] }] },
  ];
  for (const body of cases) {
    const res = await m.put('/api/manager/checklist/1').send(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.error, 'invalid_checklist');
    assert.ok(res.body.message.length > 0);
  }
  const check = await m.get('/api/manager/checklist/1');
  assert.equal(check.body.checklist.version, 1);
});

test('configurações: salvar, validar e registrar no audit_log', async () => {
  const { app, db } = makeApp();
  const m = await managerAgent(app);
  const res = await m
    .put('/api/manager/settings')
    .send({ meta_pontos: 160, bonus_base: '250,50', turno_fim: '18:30', nome_loja: 'Nil', dias_expediente: [1, 2, 3, 4, 5, 6] })
    .expect(200);
  assert.equal(res.body.settings.meta_pontos, 160);
  assert.equal(res.body.settings.bonus_base, 250.5);
  assert.equal(res.body.settings.turno_fim, '18:30');
  assert.deepEqual(res.body.settings.dias_expediente, [1, 2, 3, 4, 5, 6]);

  await m.put('/api/manager/settings').send({ meta_pontos: 0 }).expect(400);
  await m.put('/api/manager/settings').send({ turno_inicio: '19:00' }).expect(400);
  await m.put('/api/manager/settings').send({ turno_fim: '25:00' }).expect(400);

  const log = db.prepare("SELECT * FROM audit_log WHERE action = 'settings.update'").all();
  assert.equal(log.length, 1);
});

test('roteiro: criar, editar, aparecer no dia e excluir', async () => {
  const { app } = makeApp();
  const m = await managerAgent(app);
  const created = await m
    .post('/api/manager/posts')
    .send({ weekday: 1, slot: 1, channel: 'Grupo VIP', product_line: 'Skincare', hook: 'Pele pronta', caption: 'Legenda', cta: 'Chama no direct' })
    .expect(201);
  const id = created.body.post.id;
  await m.put(`/api/manager/posts/${id}`).send({ ...created.body.post, hook: 'Pele pronta em 3 passos' }).expect(200);
  await m.post('/api/manager/posts').send({ weekday: 1, slot: 9, hook: 'x' }).expect(400);
  await m.post('/api/manager/posts').send({ weekday: 1, slot: 2 }).expect(400);

  const employee = await employeeAgent(app, request);
  const day = await employee.get(`/api/day/${MONDAY}`).expect(200);
  assert.equal(day.body.posts.length, 1);
  assert.equal(day.body.posts[0].hook, 'Pele pronta em 3 passos');

  await m.delete(`/api/manager/posts/${id}`).expect(200);
  await m.get(`/api/manager/posts/${id}`).expect(404);
  const after = await employee.get(`/api/day/${MONDAY}`).expect(200);
  assert.equal(after.body.posts.length, 0);
});

test('funcionária não acessa o editor', async () => {
  const { app } = makeApp();
  const employee = await employeeAgent(app, request);
  await employee.get('/api/manager/checklist/1').expect(403);
  await employee.put('/api/manager/checklist/1').send({}).expect(403);
  await employee.post('/api/manager/posts').send({}).expect(403);
});
