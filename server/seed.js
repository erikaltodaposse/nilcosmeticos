import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { hashSecret } from './lib/auth.js';
import { nowISO } from './lib/date.js';
import { DEFAULT_SETTINGS, DEFAULT_CLEANING_FOCUS, DEFAULT_SECTIONS, defaultPosts } from './lib/defaults.js';

export const INITIAL_EMPLOYEE_PIN = '1234';

/**
 * Popula o banco sem sobrescrever nada que já exista: pode rodar de novo com segurança.
 * Retorna um resumo do que foi criado.
 */
export async function seed(db, env = process.env) {
  const email = (env.MANAGER_EMAIL || '').trim().toLowerCase();
  const password = env.MANAGER_PASSWORD || '';
  if (!email || !password) {
    throw new Error('Defina MANAGER_EMAIL e MANAGER_PASSWORD no .env antes de rodar o seed.');
  }
  if (password.length < 8) {
    throw new Error('MANAGER_PASSWORD precisa ter pelo menos 8 caracteres.');
  }

  const now = nowISO();
  const created = { manager: false, employee: false, settings: 0, checklist: false, posts: false };

  await db.transaction(async (tx) => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      created.settings += (await tx.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [key, value])).changes;
    }

    if (!(await tx.get('SELECT 1 FROM users WHERE email = ?', [email]))) {
      await tx.run(
        `INSERT INTO users (name, role, email, password_hash, created_at) VALUES (?, 'manager', ?, ?, ?)`,
        [env.MANAGER_NAME || 'Gestora', email, hashSecret(password), now],
      );
      created.manager = true;
    }

    if (!(await tx.get("SELECT 1 FROM users WHERE role = 'employee'"))) {
      await tx.run(
        `INSERT INTO users (name, role, pin_hash, must_change_pin, created_at) VALUES (?, 'employee', ?, 1, ?)`,
        [env.EMPLOYEE_NAME || 'Funcionária', hashSecret(INITIAL_EMPLOYEE_PIN), now],
      );
      created.employee = true;
    }

    if (!(await tx.get('SELECT 1 FROM checklist_versions'))) {
      for (let weekday = 0; weekday <= 6; weekday++) {
        const versionId = (await tx.run(
          'INSERT INTO checklist_versions (weekday, version, cleaning_focus, active, created_at) VALUES (?, 1, ?, 1, ?)',
          [weekday, DEFAULT_CLEANING_FOCUS[weekday], now],
        )).lastInsertRowid;
        for (const [sIdx, section] of DEFAULT_SECTIONS.entries()) {
          const sectionId = (await tx.run(
            'INSERT INTO checklist_sections (version_id, position, title, subtitle) VALUES (?, ?, ?, ?)',
            [versionId, sIdx, section.title, section.subtitle],
          )).lastInsertRowid;
          for (const [tIdx, task] of section.tasks.entries()) {
            await tx.run(
              `INSERT INTO checklist_tasks (section_id, position, text, points, requires_photo, auto, due_time, posts)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [sectionId, tIdx, task.text, task.points, task.requires_photo ? 1 : 0, task.auto ?? null, task.due_time ?? null, task.posts ? 1 : 0],
            );
          }
        }
      }
      created.checklist = true;
    }

    // Roteiro inicial, uma vez só: se a gestora apagar tudo depois, o seed não recria.
    if (!(await tx.get("SELECT 1 FROM settings WHERE key = 'roteiro_padrao_criado'"))) {
      if (!(await tx.get('SELECT 1 FROM posts WHERE active = 1'))) {
        for (const p of defaultPosts()) {
          await tx.run(
            'INSERT INTO posts (weekday, slot, time, kind, goal, image_prompt, text_prompt) VALUES (?, 0, ?, ?, ?, ?, ?)',
            [p.weekday, p.time, p.kind, p.goal, p.image_prompt, p.text_prompt],
          );
        }
        created.posts = true;
      }
      await tx.run("INSERT INTO settings (key, value) VALUES ('roteiro_padrao_criado', '1')");
    }
  });

  return created;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const db = await openDb();
  try {
    const r = await seed(db);
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
