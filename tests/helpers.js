import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoint-test-'));
  const app = createApp({ db, sessionSecret: SECRET, secureCookies: false, now: () => clock.now, uploadsDir });
  return { app, db, clock, uploadsDir };
}

/** Agente já logado como funcionária, com o PIN inicial trocado para 4321. */
export async function employeeAgent(app, request) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login/pin').send({ pin: '1234' }).expect(200);
  await agent.post('/api/auth/change-pin').send({ current_pin: '1234', new_pin: '4321' }).expect(200);
  return agent;
}

// Menor sequência que passa pela checagem de assinatura JPEG.
export const FAKE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);
