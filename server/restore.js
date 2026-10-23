// Uso: npm run restore -- caminho/do/backup.json
import fs from 'node:fs';
import { openDb } from './db.js';
import { config } from './config.js';
import { restoreBackup } from './lib/export.js';

const file = process.argv[2];
if (!file) {
  console.error('Informe o arquivo: npm run restore -- caminho/do/backup.json');
  process.exit(1);
}

const db = await openDb();
try {
  const counts = await restoreBackup(db, JSON.parse(fs.readFileSync(file, 'utf8')));
  console.log(`Backup restaurado em ${config.tursoUrl ? 'Turso' : config.dbFile}:`);
  for (const [table, n] of Object.entries(counts)) console.log(`  ${table}: ${n}`);
  if (!config.blobToken && !config.blobStoreId) console.log(`Copie também as fotos para ${config.uploadsDir}.`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  db.close();
}
