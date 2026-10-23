import express from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  PIN_RE,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSession,
  destroySession,
  findEmployeeByPin,
  hashSecret,
  publicUser,
  verifySecret,
} from '../lib/auth.js';
import { ah, requireAuth, sendError } from '../http.js';
import { todayKey } from '../lib/date.js';

export function authRouter({ secureCookies }) {
  const router = express.Router();

  // 5 tentativas erradas por 5 minutos por IP, somando PIN e senha. Login certo não consome a cota.
  const loginLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 5,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) =>
      sendError(res, 429, 'too_many_attempts', 'Muitas tentativas. Aguarde 5 minutos e tente de novo.'),
  });

  async function startSession(req, res, user) {
    const token = await createSession(req.app.locals.db, user.id);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: secureCookies,
      sameSite: 'lax',
      signed: true,
      maxAge: SESSION_TTL_MS,
      path: '/',
    });
    res.json({ user: publicUser(user) });
  }

  router.post('/login/pin', loginLimiter, ah(async (req, res) => {
    const pin = req.body?.pin;
    if (typeof pin !== 'string' || !PIN_RE.test(pin)) {
      return sendError(res, 400, 'invalid_pin_format', 'O PIN tem de 4 a 6 números.');
    }
    const user = await findEmployeeByPin(req.app.locals.db, pin);
    if (!user) return sendError(res, 401, 'invalid_credentials', 'PIN incorreto.');
    await startSession(req, res, user);
  }));

  router.post('/login/password', loginLimiter, ah(async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = req.body?.password;
    if (!email || typeof password !== 'string' || !password) {
      return sendError(res, 400, 'missing_fields', 'Informe e-mail e senha.');
    }
    const user = await req.app.locals.db.get("SELECT * FROM users WHERE email = ? AND role = 'manager' AND active = 1", [email]);
    if (!user || !verifySecret(password, user.password_hash)) {
      return sendError(res, 401, 'invalid_credentials', 'E-mail ou senha incorretos.');
    }
    await startSession(req, res, user);
  }));

  router.post('/logout', requireAuth({ allowPendingPin: true }), ah(async (req, res) => {
    await destroySession(req.app.locals.db, req.signedCookies[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  }));

  router.post('/change-pin', requireAuth({ allowPendingPin: true }), ah(async (req, res) => {
    if (req.user.role !== 'employee') {
      return sendError(res, 403, 'forbidden', 'Só a funcionária troca PIN.');
    }
    const { current_pin: currentPin, new_pin: newPin } = req.body ?? {};
    if (typeof newPin !== 'string' || !PIN_RE.test(newPin)) {
      return sendError(res, 400, 'invalid_pin_format', 'O novo PIN precisa ter de 4 a 6 números.');
    }
    if (!verifySecret(currentPin, req.user.pin_hash)) {
      return sendError(res, 400, 'wrong_current_pin', 'O PIN atual está incorreto.');
    }
    if (newPin === currentPin) {
      return sendError(res, 400, 'same_pin', 'O novo PIN precisa ser diferente do atual.');
    }
    const db = req.app.locals.db;
    const owner = await findEmployeeByPin(db, newPin);
    if (owner && owner.id !== req.user.id) {
      return sendError(res, 400, 'pin_unavailable', 'Escolha outro PIN.');
    }
    await db.run('UPDATE users SET pin_hash = ?, must_change_pin = 0 WHERE id = ?', [hashSecret(newPin), req.user.id]);
    const updated = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    res.json({ user: publicUser(updated) });
  }));

  return router;
}

export function meRouter() {
  const router = express.Router();
  router.get('/', requireAuth({ allowPendingPin: true }), (req, res) => {
    res.json({ user: publicUser(req.user), today: todayKey(req.app.locals.now()) });
  });
  return router;
}
