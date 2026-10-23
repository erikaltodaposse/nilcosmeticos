import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { seed } from '../server/seed.js';

export const MANAGER = { email: 'gestora@exemplo.com', password: 'senha-forte-123' };
export const SECRET = 'x'.repeat(64);

/** App novo com banco em memória já semeado. */
export function makeApp() {
  const db = openDb(':memory:');
  seed(db, { MANAGER_EMAIL: MANAGER.email, MANAGER_PASSWORD: MANAGER.password, EMPLOYEE_NAME: 'Ana' });
  const app = createApp({ db, sessionSecret: SECRET, secureCookies: false });
  return { app, db };
}
