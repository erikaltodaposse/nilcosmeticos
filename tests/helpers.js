import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { seed } from '../server/seed.js';

export const MANAGER = { email: 'gestora@exemplo.com', password: 'senha-forte-123' };
export const SECRET = 'x'.repeat(64);

// Segunda-feira, 26/10/2026, 15h em Manaus.
export const MONDAY = '2026-10-26';
export const MONDAY_15H = new Date('2026-10-26T19:00:00Z');

/** App novo com banco em memória já semeado. `clock.now` pode ser trocado durante o teste. */
export function makeApp({ now = MONDAY_15H } = {}) {
  const db = openDb(':memory:');
  seed(db, { MANAGER_EMAIL: MANAGER.email, MANAGER_PASSWORD: MANAGER.password, EMPLOYEE_NAME: 'Ana' });
  const clock = { now };
  const app = createApp({ db, sessionSecret: SECRET, secureCookies: false, now: () => clock.now });
  return { app, db, clock };
}

/** Agente já logado como funcionária, com o PIN inicial trocado para 4321. */
export async function employeeAgent(app, request) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login/pin').send({ pin: '1234' }).expect(200);
  await agent.post('/api/auth/change-pin').send({ current_pin: '1234', new_pin: '4321' }).expect(200);
  return agent;
}
