import { randomUUID } from 'node:crypto';
import type { Types } from 'mongoose';
import {
  emailSchema,
  passwordSchema,
  permissionsForRole,
  type ChangePasswordInput,
  type LoginInput,
  type SessionDto,
} from '@stockflow/shared';
import { env } from '../../config/env.js';
import { AppError, fieldError, unauthenticated } from '../../lib/errors.js';
import { toUserDto } from '../users/user.dto.js';
import { User, type UserRecord } from '../users/user.model.js';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './passwords.js';
import { Session } from './session.model.js';
import { generateRefreshToken, hashToken, signAccessToken } from './tokens.js';

/**
 * A rotated refresh token stays usable for a few seconds so that two tabs
 * refreshing at the same moment don't trigger reuse detection against each other.
 */
const ROTATION_GRACE_MS = 10_000;

export interface ClientMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export interface IssuedSession extends SessionDto {
  refreshToken: string;
}

const sessionExpired = () => unauthenticated('Your session has expired. Sign in again.');

async function createSession(userId: Types.ObjectId, familyId: string, meta: ClientMeta) {
  const refreshToken = generateRefreshToken();
  const session = await Session.create({
    userId,
    tokenHash: hashToken(refreshToken),
    familyId,
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    userAgent: meta.userAgent?.slice(0, 500),
    ip: meta.ip,
  });
  return { refreshToken, session };
}

function issue(user: UserRecord, refreshToken: string): IssuedSession {
  return {
    accessToken: signAccessToken({ id: user._id.toString(), role: user.role }),
    refreshToken,
    user: toUserDto(user),
    permissions: [...permissionsForRole(user.role)],
  };
}

export async function login(input: LoginInput, meta: ClientMeta): Promise<IssuedSession> {
  const user = await User.findOne({ email: input.email }).select('+passwordHash');
  if (!user) {
    await verifyAgainstDummy(input.password);
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
  }
  if (!(await verifyPassword(input.password, user.passwordHash))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
  }
  if (!user.isActive) {
    throw new AppError(403, 'ACCOUNT_DISABLED', 'This account has been deactivated');
  }

  user.lastLoginAt = new Date();
  await user.save();

  const { refreshToken } = await createSession(user._id, randomUUID(), meta);
  return issue(user.toObject(), refreshToken);
}

export async function refresh(refreshToken: string, meta: ClientMeta): Promise<IssuedSession> {
  const now = new Date();
  const session = await Session.findOne({ tokenHash: hashToken(refreshToken) });
  if (!session || session.expiresAt <= now) throw sessionExpired();

  if (session.revokedAt) {
    const recentlyRotated =
      session.replacedBy !== null &&
      now.getTime() - session.revokedAt.getTime() < ROTATION_GRACE_MS;
    if (!recentlyRotated) {
      // A rotated token was presented again: treat it as stolen and end every session in the family.
      await Session.updateMany({ familyId: session.familyId, revokedAt: null }, { revokedAt: now });
      throw sessionExpired();
    }
  }

  const user = await User.findById(session.userId).lean();
  if (!user || !user.isActive) {
    await Session.updateMany({ familyId: session.familyId, revokedAt: null }, { revokedAt: now });
    throw sessionExpired();
  }

  const next = await createSession(user._id, session.familyId, meta);
  await Session.updateOne(
    { _id: session._id },
    {
      $set: {
        revokedAt: session.revokedAt ?? now,
        replacedBy: session.replacedBy ?? next.session._id,
      },
    },
  );
  return issue(user, next.refreshToken);
}

export async function logout(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return;
  await Session.updateOne(
    { tokenHash: hashToken(refreshToken), revokedAt: null },
    { revokedAt: new Date() },
  );
}

export async function revokeUserSessions(
  userId: string,
  exceptRefreshToken?: string,
): Promise<void> {
  await Session.updateMany(
    {
      userId,
      revokedAt: null,
      ...(exceptRefreshToken ? { tokenHash: { $ne: hashToken(exceptRefreshToken) } } : {}),
    },
    { revokedAt: new Date() },
  );
}

export async function changePassword(
  userId: string,
  input: ChangePasswordInput,
  currentRefreshToken: string | undefined,
) {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) throw unauthenticated();
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw fieldError('currentPassword', 'Current password is incorrect');
  }

  user.passwordHash = await hashPassword(input.newPassword);
  user.mustChangePassword = false;
  await user.save();
  await revokeUserSessions(userId, currentRefreshToken);
  return toUserDto(user.toObject());
}

export async function getProfile(userId: string) {
  const user = await User.findById(userId).lean();
  if (!user) throw unauthenticated();
  return { user: toUserDto(user), permissions: [...permissionsForRole(user.role)] };
}

export async function ensureBootstrapAdmin(log: (message: string) => void): Promise<void> {
  const email = env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) return;
  if ((await User.estimatedDocumentCount()) > 0) return;

  const emailResult = emailSchema.safeParse(email);
  const passwordResult = passwordSchema.safeParse(password);
  if (!emailResult.success || !passwordResult.success) {
    throw new Error(
      'BOOTSTRAP_ADMIN_EMAIL or BOOTSTRAP_ADMIN_PASSWORD is invalid (password needs 10+ characters)',
    );
  }

  await User.create({
    name: env.BOOTSTRAP_ADMIN_NAME,
    email,
    passwordHash: await hashPassword(password),
    role: 'admin',
    mustChangePassword: true,
  });
  log(`Created bootstrap admin ${email}; a password change is required at first sign-in`);
}
