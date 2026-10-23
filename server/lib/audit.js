import { nowISO } from './date.js';

export function logAudit(db, actorId, action, payload, now = new Date()) {
  db.prepare('INSERT INTO audit_log (actor_id, action, payload, created_at) VALUES (?, ?, ?, ?)').run(
    actorId,
    action,
    payload == null ? null : JSON.stringify(payload),
    nowISO(now),
  );
}
