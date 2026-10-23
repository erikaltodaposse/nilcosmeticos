import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { sendError } from './http.js';
import { authRouter, meRouter } from './routes/auth.js';
import { managerRouter } from './routes/manager.js';
import { dayRouter } from './routes/day.js';
import { diskPhotoStore, blobPhotoStore } from './lib/photos.js';

/**
 * Monta o app sem abrir porta, para os testes usarem com supertest.
 * `db` é uma conexão de openDb(); `sessionSecret` assina o cookie; `now` permite fixar o relógio nos testes;
 * `photos` é onde as fotos ficam (Vercel Blob se houver token, senão a pasta de uploads).
 */
export function createApp({
  db,
  sessionSecret,
  secureCookies = config.isProduction,
  publicDir = config.publicDir,
  photos = config.blobToken ? blobPhotoStore(config.blobToken) : diskPhotoStore(config.uploadsDir),
  trustProxy = config.onVercel ? true : 'loopback',
  now = () => new Date(),
}) {
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET precisa ter pelo menos 32 caracteres.');
  }

  const app = express();
  app.locals.db = db;
  app.locals.now = now;
  app.locals.photos = photos;
  app.disable('x-powered-by');
  // Para o limite de tentativas de login ver o IP real: na Vercel o proxy da plataforma reescreve
  // X-Forwarded-For; num servidor próprio, só o proxy local (Caddy) é confiável.
  app.set('trust proxy', trustProxy);

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
  // Link gravado na etiqueta NFC: abre o app, que lê o código do endereço e registra o ponto.
  app.get('/ponto/:token', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(publicDir, 'index.html'));
  });

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
