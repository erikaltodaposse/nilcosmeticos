import { SESSION_COOKIE, findSessionUser } from './lib/auth.js';

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function sendError(res, status, code, message) {
  res.status(status).json({ error: code, message });
}

/**
 * Exige sessão válida. Com troca de PIN pendente, só libera as rotas marcadas com allowPendingPin.
 */
export function requireAuth({ allowPendingPin = false } = {}) {
  return (req, res, next) => {
    const user = findSessionUser(req.app.locals.db, req.signedCookies[SESSION_COOKIE]);
    if (!user) return sendError(res, 401, 'unauthenticated', 'Faça login para continuar.');
    if (user.must_change_pin && !allowPendingPin) {
      return sendError(res, 403, 'pin_change_required', 'Troque o PIN inicial antes de continuar.');
    }
    req.user = user;
    next();
  };
}

export function requireRole(...roles) {
  return [
    requireAuth(),
    (req, res, next) => {
      if (!roles.includes(req.user.role)) {
        return sendError(res, 403, 'forbidden', 'Seu perfil não tem acesso a esta área.');
      }
      next();
    },
  ];
}
