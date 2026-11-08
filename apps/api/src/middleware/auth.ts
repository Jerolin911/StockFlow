import type { Request, RequestHandler } from 'express';
import { permissionsForRole, type Permission } from '@stockflow/shared';
import { AppError, forbidden, unauthenticated } from '../lib/errors.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';
import { User } from '../modules/users/user.model.js';
import type { AuthContext } from '../types/express.js';

interface AuthenticateOptions {
  allowPendingPasswordChange?: boolean;
}

/**
 * Verifies the bearer token, then reloads the user so deactivation and role
 * changes take effect immediately rather than when the token expires.
 */
export function authenticate(options: AuthenticateOptions = {}): RequestHandler {
  return async (req, _res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthenticated();

    const { userId } = verifyAccessToken(header.slice('Bearer '.length));
    const user = await User.findById(userId).lean();
    if (!user || !user.isActive) throw unauthenticated('Your session is no longer valid');

    if (user.mustChangePassword && !options.allowPendingPasswordChange) {
      throw new AppError(
        403,
        'PASSWORD_CHANGE_REQUIRED',
        'You must change your password to continue',
      );
    }

    req.auth = {
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
      permissions: permissionsForRole(user.role),
    };
    next();
  };
}

export function authorize(...required: Permission[]): RequestHandler {
  return (req, _res, next) => {
    const auth = requireAuth(req);
    if (!required.every((permission) => auth.permissions.includes(permission))) throw forbidden();
    next();
  };
}

export function requireAuth(req: Request): AuthContext {
  if (!req.auth) throw unauthenticated();
  return req.auth;
}
