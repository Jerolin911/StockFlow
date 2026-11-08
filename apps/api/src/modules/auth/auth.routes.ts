import { Router, type CookieOptions, type Request, type Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { changePasswordSchema, loginSchema, type SessionDto } from '@stockflow/shared';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { authenticate, requireAuth } from '../../middleware/auth.js';
import * as authService from './auth.service.js';

export const REFRESH_COOKIE = 'sf_refresh';
export const AUTH_COOKIE_PATH = '/api/v1/auth';

const cookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: env.cookieSecure,
  sameSite: 'strict',
  path: AUTH_COOKIE_PATH,
  maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
});

function clientMeta(req: Request): authService.ClientMeta {
  return { ip: req.ip, userAgent: req.get('user-agent') };
}

function readRefreshCookie(req: Request): string | undefined {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function sendSession(res: Response, session: authService.IssuedSession) {
  const { refreshToken, ...body } = session;
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions());
  res.json({ data: body satisfies SessionDto });
}

function clearRefreshCookie(res: Response) {
  const { maxAge: _maxAge, ...options } = cookieOptions();
  res.clearCookie(REFRESH_COOKIE, options);
}

const rateLimited = () =>
  new AppError(429, 'RATE_LIMITED', 'Too many sign-in attempts. Try again in a few minutes.');

export function createAuthRouter(): Router {
  const router = Router();

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: env.LOGIN_RATE_LIMIT,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => {
      const email: unknown = (req.body as { email?: unknown } | undefined)?.email;
      const normalised = typeof email === 'string' ? email.trim().toLowerCase() : '';
      return `${ipKeyGenerator(req.ip ?? '')}:${normalised}`;
    },
    handler: (_req, _res, next) => next(rateLimited()),
  });

  const ipLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: env.LOGIN_RATE_LIMIT * 5,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(rateLimited()),
  });

  router.post('/login', ipLimiter, loginLimiter, async (req, res) => {
    const input = loginSchema.parse(req.body);
    sendSession(res, await authService.login(input, clientMeta(req)));
  });

  router.post('/refresh', async (req, res) => {
    const token = readRefreshCookie(req);
    if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'No active session');
    try {
      sendSession(res, await authService.refresh(token, clientMeta(req)));
    } catch (error) {
      clearRefreshCookie(res);
      throw error;
    }
  });

  router.post('/logout', async (req, res) => {
    await authService.logout(readRefreshCookie(req));
    clearRefreshCookie(res);
    res.status(204).end();
  });

  router.get('/me', authenticate({ allowPendingPasswordChange: true }), async (req, res) => {
    res.json({ data: await authService.getProfile(requireAuth(req).user.id) });
  });

  router.post(
    '/change-password',
    authenticate({ allowPendingPasswordChange: true }),
    async (req, res) => {
      const input = changePasswordSchema.parse(req.body);
      const user = await authService.changePassword(
        requireAuth(req).user.id,
        input,
        readRefreshCookie(req),
      );
      res.json({ data: user });
    },
  );

  return router;
}
