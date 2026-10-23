import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

dotenv.config({ path: path.join(ROOT_DIR, '.env'), quiet: true });

const dataDir = process.env.DATA_DIR
  ? path.resolve(ROOT_DIR, process.env.DATA_DIR)
  : path.join(ROOT_DIR, 'data');

export const config = {
  rootDir: ROOT_DIR,
  publicDir: path.join(ROOT_DIR, 'public'),
  dataDir,
  dbFile: path.join(dataDir, 'app.db'),
  uploadsDir: path.join(dataDir, 'uploads'),
  port: Number(process.env.PORT) || 3000,
  isProduction: process.env.NODE_ENV === 'production',
  sessionSecret: process.env.SESSION_SECRET || '',
  // Na Vercel: banco no Turso e fotos no Vercel Blob. Sem essas variáveis, tudo fica em DATA_DIR.
  tursoUrl: process.env.TURSO_DATABASE_URL || '',
  tursoToken: process.env.TURSO_AUTH_TOKEN || '',
  blobToken: process.env.BLOB_READ_WRITE_TOKEN || '',
  onVercel: Boolean(process.env.VERCEL),
};
