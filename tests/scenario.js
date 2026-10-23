import request from 'supertest';
import { makeApp, MANAGER, employeeAgent, FAKE_JPEG } from './helpers.js';

// Manaus é UTC-4 o ano todo.
export const at = (date, hhmm) => new Date(`${date}T${hhmm}:00-04:00`);

/** Simula um dia inteiro da funcionária, pulando as tarefas cujo texto começa com algum item de `skip`. */
async function workDay(agent, clock, date, { skip = [], checkout = '18:05', close = true } = {}) {
  clock.now = at(date, '13:00');
  let res = await agent.post(`/api/day/${date}/checkin`).expect(200);
  const tasks = res.body.day.sections.flatMap((s) => s.tasks).filter((t) => !t.auto);
  for (const task of tasks) {
    if (skip.some((prefix) => task.text.startsWith(prefix))) continue;
    if (task.requires_photo) {
      await agent.post(`/api/day/${date}/tasks/${task.id}/photo`).attach('photo', FAKE_JPEG, { filename: 'f.jpg', contentType: 'image/jpeg' }).expect(200);
    } else {
      await agent.put(`/api/day/${date}/tasks/${task.id}`).expect(200);
    }
  }
  clock.now = at(date, checkout);
  await agent.post(`/api/day/${date}/checkout`).expect(200);
  if (close) await agent.post(`/api/day/${date}/close`).expect(200);
}

/** Semana de 26 a 30/10/2026 com dias completos, falhas, atraso e uma falta; segunda 2/11 em andamento. */
export async function scenario() {
  const ctx = makeApp();
  const { app, clock } = ctx;
  const employee = await employeeAgent(app, request);
  await workDay(employee, clock, '2026-10-26');
  await workDay(employee, clock, '2026-10-27', { skip: ['Limpeza final', 'Post 3'] });
  await workDay(employee, clock, '2026-10-28', { skip: ['Limpeza final'], checkout: '18:20', close: false });
  // Quinta 29: falta, sem registro.
  await workDay(employee, clock, '2026-10-30', { skip: ['Limpeza final', 'Reposição'] });
  // Segunda 2/11 em andamento: entra no histórico, não nos números.
  clock.now = at('2026-11-02', '14:00');
  await employee.post('/api/day/2026-11-02/checkin').expect(200);

  const manager = request.agent(app);
  await manager.post('/api/auth/login/password').send(MANAGER).expect(200);
  await manager.put('/api/manager/settings').send({ bonus_base: 200 }).expect(200);
  return { ...ctx, employee, manager };
}
