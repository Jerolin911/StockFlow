import type { Express } from 'express';
import request from 'supertest';
import type { Role, SessionDto } from '@stockflow/shared';
import { hashPassword } from '../src/modules/auth/passwords.js';
import { User } from '../src/modules/users/user.model.js';

export const TEST_PASSWORD = 'correct-horse-battery';

let counter = 0;

export async function createUser(
  overrides: Partial<{
    name: string;
    email: string;
    role: Role;
    password: string;
    isActive: boolean;
    mustChangePassword: boolean;
  }> = {},
) {
  counter += 1;
  const { password = TEST_PASSWORD, ...rest } = overrides;
  const user = await User.create({
    name: `Test User ${counter}`,
    email: `user${counter}@stockflow.test`,
    role: 'staff',
    ...rest,
    passwordHash: await hashPassword(password),
  });
  return { id: user._id.toString(), email: user.email, password, role: user.role };
}

export interface LoggedIn {
  accessToken: string;
  refreshCookie: string;
  body: SessionDto;
}

export function extractRefreshCookie(setCookie: string[] | string | undefined): string {
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const cookie = cookies.find((c) => c.startsWith('sf_refresh='));
  if (!cookie) throw new Error('No refresh cookie set');
  return cookie.split(';')[0]!;
}

export async function login(
  app: Express,
  email: string,
  password = TEST_PASSWORD,
): Promise<LoggedIn> {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200)
    throw new Error(`Login failed: ${res.status} ${JSON.stringify(res.body)}`);
  const body = res.body.data as SessionDto;
  return {
    accessToken: body.accessToken,
    refreshCookie: extractRefreshCookie(res.headers['set-cookie']),
    body,
  };
}

export async function createAndLogin(app: Express, role: Role) {
  const user = await createUser({ role });
  return { user, ...(await login(app, user.email)) };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
