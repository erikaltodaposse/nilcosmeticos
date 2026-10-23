import fs from 'node:fs';
import { config } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { purgeExpiredSessions } from './lib/auth.js';

fs.mkdirSync(config.uploadsDir, { recursive: true });
const db = openDb(config.dbFile);
purgeExpiredSessions(db);

const app = createApp({ db, sessionSecret: config.sessionSecret });

const server = app.listen(config.port, () => {
  console.log(`Checkpoint Nil rodando em http://localhost:${config.port}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
