import express from 'express';
import { requireRole } from '../http.js';

export function managerRouter() {
  const router = express.Router();
  router.use(requireRole('manager'));

  router.get('/settings', (req, res) => {
    const rows = req.app.locals.db.prepare('SELECT key, value FROM settings ORDER BY key').all();
    res.json({ settings: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
  });

  return router;
}
