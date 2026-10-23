// Código da etiqueta NFC do ponto. Fica em settings.nfc_token e é comparado em tempo constante.
import crypto from 'node:crypto';

const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

function newToken() {
  return crypto.randomBytes(24).toString('base64url'); // 32 caracteres
}

/** Devolve o código atual, criando um na primeira vez. */
export function getNfcToken(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'nfc_token'").get();
  if (row?.value && TOKEN_RE.test(row.value)) return row.value;
  return rotateNfcToken(db);
}

export function rotateNfcToken(db) {
  const token = newToken();
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('nfc_token', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(token);
  return token;
}

export function isNfcRequired(db) {
  return db.prepare("SELECT value FROM settings WHERE key = 'ponto_exige_nfc'").get()?.value === '1';
}

export function checkNfcToken(db, candidate) {
  if (typeof candidate !== 'string' || !TOKEN_RE.test(candidate)) return false;
  const a = Buffer.from(getNfcToken(db));
  const b = Buffer.from(candidate);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
