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
  const { app } = await makeApp();
  const m = await managerAgent(app);
  const res = await m.get('/api/manager/checklist/1').expect(200);
  assert.equal(res.body.checklist.version, 1);
  assert.equal(res.body.checklist.cleaning_focus, 'hall principal e entrada');
  assert.equal(res.body.checklist.sections.length, 4);
  await m.get('/api/manager/checklist/7').expect(400);
});

test('editar e salvar vale para o dia seguinte e não altera o passado', async () => {
  const { app, clock } = await makeApp();
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
  const { app } = await makeApp();
  const employee = await employeeAgent(app, request);
  const m = await managerAgent(app);
  await employee.get(`/api/day/${MONDAY}`).expect(200); // abre a tela, sem registrar nada
  const { body } = await m.get('/api/manager/checklist/1');
  body.checklist.sections[0].tasks[1].points = 25;
  await m.put('/api/manager/checklist/1').send(body.checklist).expect(200);
  const day = await employee.get(`/api/day/${MONDAY}`).expect(200);
  assert.equal(day.body.day.points.max, 170);
});

test('restaurar padrão volta às 12 tarefas', async () => {
  const { app } = await makeApp();
  const m = await managerAgent(app);
  await m
    .put('/api/manager/checklist/3')
    .send({ cleaning_focus: 'x', sections: [{ title: 'Único', tasks: [{ text: 'Uma tarefa', points: 5 }] }] })
    .expect(200);
  const res = await m.post('/api/manager/checklist/3/restore').expect(200);
  const tasks = res.body.checklist.sections.flatMap((s) => s.tasks);
  assert.equal(tasks.length, 12);
  assert.equal(tasks.reduce((s, t) => s + t.points, 0), 150);
  assert.equal(res.body.checklist.cleaning_focus, 'hall e banheiro');
  assert.equal(res.body.checklist.version, 3);
});

test('checklist inválido é recusado com mensagem clara', async () => {
  const { app } = await makeApp();
  const m = await managerAgent(app);
  const cases = [
    { sections: [] },
    { sections: [{ title: '', tasks: [{ text: 'a', points: 1 }] }] },
    { sections: [{ title: 'A', tasks: [{ text: '', points: 1 }] }] },
    { sections: [{ title: 'A', tasks: [{ text: 'a', points: -1 }] }] },
    { sections: [{ title: 'A', tasks: [{ text: 'a', points: 1.5 }] }] },
    { sections: [{ title: 'A', tasks: [{ text: 'a', points: 1, due_time: '25:00' }] }] },
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
  const { app, db } = await makeApp();
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

  const log = await db.all("SELECT * FROM audit_log WHERE action = 'settings.update'");
  assert.equal(log.length, 1);
});

function postsOfDay(body) {
  return body.day.sections.flatMap((sec) => sec.tasks).find((t) => t.posts).posts;
}

test('roteiro: criar, editar, aparecer no dia e excluir', async () => {
  const { app } = await makeApp();
  const m = await managerAgent(app);
  const weekly = (await m.get('/api/manager/posts').expect(200)).body.weekly;
  assert.equal(weekly.filter((p) => p.weekday === 1).length, 3); // roteiro padrão do seed

  const created = await m
    .post('/api/manager/posts')
    .send({ weekday: 1, time: '11:00', kind: 'mensagem', goal: 'Lembrete', image_prompt: 'Foto de batom', text_prompt: 'Mensagem curta' })
    .expect(201);
  const id = created.body.post.id;
  await m.put(`/api/manager/posts/${id}`).send({ ...created.body.post, goal: 'Lembrete da promoção' }).expect(200);
  await m.post('/api/manager/posts').send({ weekday: 1, time: '25:00', kind: 'feed', image_prompt: 'x' }).expect(400);
  await m.post('/api/manager/posts').send({ weekday: 1, time: '10:00', kind: 'feed' }).expect(400);
  await m.post('/api/manager/posts').send({ weekday: 1, time: '10:00', kind: 'outdoor', image_prompt: 'x' }).expect(400);

  const employee = await employeeAgent(app, request);
  const day = await employee.get(`/api/day/${MONDAY}`).expect(200);
  const posts = postsOfDay(day.body);
  assert.equal(posts.length, 4);
  assert.equal(posts[0].goal, 'Lembrete da promoção'); // em ordem de horário
  assert.match(posts[0].image_prompt_full, /^Foto de batom\n\nEstilo Nil/);

  await m.delete(`/api/manager/posts/${id}`).expect(200);
  await m.get(`/api/manager/posts/${id}`).expect(404);
  const after = await employee.get(`/api/day/${MONDAY}`).expect(200);
  assert.equal(postsOfDay(after.body).length, 3);
});

test('postagens: até 10 por dia, marcadas uma a uma, com atraso sem perder pontos', async () => {
  const { app, clock } = await makeApp();
  const m = await managerAgent(app);
  for (let i = 0; i < 7; i++) {
    await m.post('/api/manager/posts').send({ weekday: 1, time: `1${i}:45`, kind: 'stories', image_prompt: `p${i}` }).expect(201);
  }
  const extra = await m.post('/api/manager/posts').send({ weekday: 1, time: '18:30', kind: 'feed', image_prompt: 'x' });
  assert.equal(extra.status, 409);

  const employee = await employeeAgent(app, request);
  let res = await employee.post(`/api/day/${MONDAY}/checkin`).expect(200);
  const task = res.body.day.sections.flatMap((s) => s.tasks).find((t) => t.posts);
  assert.equal(task.posts.length, 10);
  await employee.put(`/api/day/${MONDAY}/tasks/${task.id}`).expect(409); // só postagem por postagem

  const before = res.body.day.points.earned;
  const [first, second] = task.posts; // 10:45 e 11:45; o relógio está em 15:00
  res = await employee.put(`/api/day/${MONDAY}/posts/${first.id}`).expect(200);
  assert.equal(res.body.day.points.earned, before + 3);
  res = await employee.put(`/api/day/${MONDAY}/posts/${second.id}`).expect(200);
  const marked = postsOfDay(res.body);
  assert.equal(marked[0].done, true);
  assert.equal(marked[0].late, true);
  assert.equal(res.body.day.points.earned, before + 6);
  res = await employee.delete(`/api/day/${MONDAY}/posts/${second.id}`).expect(200);
  assert.equal(res.body.day.points.earned, before + 3);

  for (const post of task.posts) await employee.put(`/api/day/${MONDAY}/posts/${post.id}`).expect(200);
  res = await employee.get(`/api/day/${MONDAY}`).expect(200);
  const done = res.body.day.sections.flatMap((s) => s.tasks).find((t) => t.posts);
  assert.equal(done.done, true);
  assert.equal(res.body.day.points.earned, before + 30);

  clock.now = new Date('2026-10-26T22:00:00Z');
  res = await employee.get(`/api/day/${MONDAY}`).expect(200);
  assert.equal(res.body.now_time, '18:00');
});

test('programação por data substitui o roteiro da semana e pode ser copiada', async () => {
  const { app } = await makeApp();
  const m = await managerAgent(app);
  await m.post('/api/manager/posts').send({ date: '2026-11-03', time: '14:00', kind: 'feed', goal: 'Lançamento', image_prompt: 'Vitrine' }).expect(201);
  const month = await m.get('/api/manager/posts?from=2026-11-01&to=2026-11-30').expect(200);
  assert.equal(month.body.dated.length, 1);
  assert.equal(month.body.dated[0].weekday, 2);

  const copy = await m.post('/api/manager/posts/copy').send({ source_date: '2026-11-03', target_dates: ['2026-11-04', '2026-11-05'] }).expect(200);
  assert.deepEqual(copy.body.dates, ['2026-11-04', '2026-11-05']);
  const after = await m.get('/api/manager/posts?from=2026-11-01&to=2026-11-30').expect(200);
  assert.deepEqual(after.body.dated.map((p) => p.date), ['2026-11-03', '2026-11-04', '2026-11-05']);

  // Copiar um dia sem programação própria leva o roteiro da semana dele.
  await m.post('/api/manager/posts/copy').send({ source_date: '2026-11-09', target_dates: ['2026-11-04'] }).expect(200);
  const wed = (await m.get('/api/manager/posts?from=2026-11-04&to=2026-11-04').expect(200)).body.dated;
  assert.equal(wed.length, 3);

  const cleared = await m.delete('/api/manager/posts/day/2026-11-04').expect(200);
  assert.equal(cleared.body.removed, 3);
});

test('funcionária não acessa o editor', async () => {
  const { app } = await makeApp();
  const employee = await employeeAgent(app, request);
  await employee.get('/api/manager/checklist/1').expect(403);
  await employee.put('/api/manager/checklist/1').send({}).expect(403);
  await employee.post('/api/manager/posts').send({}).expect(403);
});
