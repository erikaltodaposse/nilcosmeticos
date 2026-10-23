// Código da etiqueta NFC do ponto. Fica em settings.nfc_token e é comparado em tempo constante.
import crypto from 'node:crypto';

const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

function newToken() {
  return crypto.randomBytes(24).toString('base64url'); // 32 caracteres
}

/** Devolve o código atual, criando um na primeira vez. */
export async function getNfcToken(db) {
  const row = await db.get("SELECT value FROM settings WHERE key = 'nfc_token'");
  if (row?.value && TOKEN_RE.test(row.value)) return row.value;
  return rotateNfcToken(db);
}

export async function rotateNfcToken(db) {
  const token = newToken();
  await db.run(
    "INSERT INTO settings (key, value) VALUES ('nfc_token', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [token],
  );
  return token;
}

export async function isNfcRequired(db) {
  return (await db.get("SELECT value FROM settings WHERE key = 'ponto_exige_nfc'"))?.value === '1';
}

export async function checkNfcToken(db, candidate) {
  if (typeof candidate !== 'string' || !TOKEN_RE.test(candidate)) return false;
  const a = Buffer.from(await getNfcToken(db));
  const b = Buffer.from(candidate);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
