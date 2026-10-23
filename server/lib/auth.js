import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { nowISO } from './date.js';

const BCRYPT_COST = 10;
export const SESSION_COOKIE = 'sid';
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const PIN_RE = /^\d{4,6}$/;

export function hashSecret(secret) {
  return bcrypt.hashSync(secret, BCRYPT_COST);
}

export function verifySecret(secret, hash) {
  if (!hash || typeof secret !== 'string') return false;
  return bcrypt.compareSync(secret, hash);
}

// O cookie carrega o token puro; o banco guarda só o hash, para um vazamento do .db não abrir sessões.
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    email: row.email ?? null,
    must_change_pin: Boolean(row.must_change_pin),
  };
}

export function createSession(db, userId, now = new Date()) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    hashToken(token),
    userId,
    nowISO(now),
    new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
  );
  return token;
}

export function findSessionUser(db, token, now = new Date()) {
  if (!token) return null;
  return (
    db
      .prepare(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
      )
      .get(hashToken(token), nowISO(now)) ?? null
  );
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

export function purgeExpiredSessions(db, now = new Date()) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowISO(now));
}

/** Procura a funcionária ativa dona deste PIN. */
export function findEmployeeByPin(db, pin) {
  const employees = db.prepare("SELECT * FROM users WHERE role = 'employee' AND active = 1").all();
  return employees.find((u) => verifySecret(pin, u.pin_hash)) ?? null;
}
