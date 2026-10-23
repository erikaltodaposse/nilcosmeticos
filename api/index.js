// Entrada da Vercel: todas as rotas /api/* chegam aqui (ver vercel.json).
// O app é montado uma vez por instância e reaproveitado entre requisições.
import { config } from '../server/config.js';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { seed } from '../server/seed.js';

let appPromise = null;

function getApp() {
  if (!config.tursoUrl) throw new Error('Defina TURSO_DATABASE_URL e TURSO_AUTH_TOKEN nas variáveis da Vercel.');
  if (!config.blobToken && !config.blobStoreId) throw new Error('Conecte um Vercel Blob ao projeto (BLOB_STORE_ID ou BLOB_READ_WRITE_TOKEN).');
  appPromise ??= openDb().then(async (db) => {
    // Com MANAGER_EMAIL e MANAGER_PASSWORD na Vercel, o seed roda na subida. Ele não sobrescreve nada que já exista.
    if (process.env.MANAGER_EMAIL && process.env.MANAGER_PASSWORD) await seed(db);
    return createApp({ db, sessionSecret: config.sessionSecret });
  });
  appPromise.catch(() => { appPromise = null; });
  return appPromise;
}

export default async function handler(req, res) {
  try {
    const app = await getApp();
    app(req, res);
  } catch (err) {
    console.error(`[inicialização] ${err.message}`);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // O motivo vai na tela para quem configura não depender do log. As mensagens nunca trazem o valor das chaves.
    const reason = String(err.message || err).slice(0, 300);
    res.end(JSON.stringify({ error: 'server_not_configured', message: `O servidor não está configurado: ${reason}` }));
  }
}

