import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { sendError } from './http.js';
import { authRouter, meRouter } from './routes/auth.js';
import { managerRouter } from './routes/manager.js';
import { dayRouter } from './routes/day.js';

/**
 * Monta o app sem abrir porta, para os testes usarem com supertest.
 * `db` é uma conexão de openDb(); `sessionSecret` assina o cookie; `now` permite fixar o relógio nos testes.
 */
export function createApp({
  db,
  sessionSecret,
  secureCookies = config.isProduction,
  publicDir = config.publicDir,
  uploadsDir = config.uploadsDir,
  now = () => new Date(),
}) {
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET precisa ter pelo menos 32 caracteres.');
  }

  const app = express();
  app.locals.db = db;
  app.locals.now = now;
  app.locals.uploadsDir = uploadsDir;
  app.disable('x-powered-by');
  // Em produção o Caddy fica na frente, no mesmo host: confiar só no proxy local para ler o IP real.
  app.set('trust proxy', 'loopback');

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser(sessionSecret));
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });

  app.use('/api/auth', authRouter({ secureCookies }));
  app.use('/api/me', meRouter());
  app.use('/api/day', dayRouter());
  app.use('/api/manager', managerRouter());
  app.use('/api', (req, res) => sendError(res, 404, 'not_found', 'Rota não encontrada.'));

  app.use(express.static(publicDir, { index: 'index.html' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return sendError(res, 400, 'invalid_json', 'O corpo da requisição não é um JSON válido.');
    }
    if (err.status && err.code) return sendError(res, err.status, err.code, err.message);
    console.error(`[erro] ${req.method} ${req.path}: ${err.message}`);
    sendError(res, 500, 'internal_error', 'Algo deu errado no servidor. Tente de novo.');
  });

  return app;
}
