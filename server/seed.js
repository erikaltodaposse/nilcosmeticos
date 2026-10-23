import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { hashSecret } from './lib/auth.js';
import { nowISO } from './lib/date.js';
import { DEFAULT_SETTINGS, DEFAULT_CLEANING_FOCUS, DEFAULT_SECTIONS } from './lib/defaults.js';

export const INITIAL_EMPLOYEE_PIN = '1234';

/**
 * Popula o banco sem sobrescrever nada que já exista: pode rodar de novo com segurança.
 * Retorna um resumo do que foi criado.
 */
export function seed(db, env = process.env) {
  const email = (env.MANAGER_EMAIL || '').trim().toLowerCase();
  const password = env.MANAGER_PASSWORD || '';
  if (!email || !password) {
    throw new Error('Defina MANAGER_EMAIL e MANAGER_PASSWORD no .env antes de rodar o seed.');
  }
  if (password.length < 8) {
    throw new Error('MANAGER_PASSWORD precisa ter pelo menos 8 caracteres.');
  }

  const now = nowISO();
  const created = { manager: false, employee: false, settings: 0, checklist: false };

  db.transaction(() => {
    const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      created.settings += insertSetting.run(key, value).changes;
    }

    if (!db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      db.prepare(
        `INSERT INTO users (name, role, email, password_hash, created_at)
         VALUES (?, 'manager', ?, ?, ?)`,
      ).run(env.MANAGER_NAME || 'Gestora', email, hashSecret(password), now);
      created.manager = true;
    }

    if (!db.prepare("SELECT 1 FROM users WHERE role = 'employee'").get()) {
      db.prepare(
        `INSERT INTO users (name, role, pin_hash, must_change_pin, created_at)
         VALUES (?, 'employee', ?, 1, ?)`,
      ).run(env.EMPLOYEE_NAME || 'Funcionária', hashSecret(INITIAL_EMPLOYEE_PIN), now);
      created.employee = true;
    }

    if (!db.prepare('SELECT 1 FROM checklist_versions').get()) {
      const insertVersion = db.prepare(
        `INSERT INTO checklist_versions (weekday, version, cleaning_focus, active, created_at)
         VALUES (?, 1, ?, 1, ?)`,
      );
      const insertSection = db.prepare(
        'INSERT INTO checklist_sections (version_id, position, title, subtitle) VALUES (?, ?, ?, ?)',
      );
      const insertTask = db.prepare(
        `INSERT INTO checklist_tasks (section_id, position, text, points, requires_photo, post_slot)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (let weekday = 0; weekday <= 6; weekday++) {
        const versionId = insertVersion.run(weekday, DEFAULT_CLEANING_FOCUS[weekday], now).lastInsertRowid;
        DEFAULT_SECTIONS.forEach((section, sIdx) => {
          const sectionId = insertSection.run(versionId, sIdx, section.title, section.subtitle).lastInsertRowid;
          section.tasks.forEach((task, tIdx) => {
            insertTask.run(
              sectionId,
              tIdx,
              task.text,
              task.points,
              task.requires_photo ? 1 : 0,
              task.post_slot ?? null,
            );
          });
        });
      }
      created.checklist = true;
    }
  })();

  return created;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const db = openDb();
  try {
    const r = seed(db);
    console.log(`Gestora: ${r.manager ? 'criada' : 'já existia'}.`);
    console.log(`Funcionária: ${r.employee ? `criada com PIN ${INITIAL_EMPLOYEE_PIN} (troca obrigatória no primeiro acesso)` : 'já existia'}.`);
    console.log(`Configurações novas: ${r.settings}.`);
    console.log(`Checklist padrão: ${r.checklist ? 'criado para os 7 dias' : 'já existia'}.`);
    console.log('Roteiro de postagens: pendente (aguardando o protótipo com os 19 registros).');
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}
