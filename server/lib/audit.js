import { nowISO } from './date.js';

export async function logAudit(db, actorId, action, payload, now = new Date()) {
  await db.run('INSERT INTO audit_log (actor_id, action, payload, created_at) VALUES (?, ?, ?, ?)', [
    actorId,
    action,
    payload == null ? null : JSON.stringify(payload),
    nowISO(now),
  ]);
}
