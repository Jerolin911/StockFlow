import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Session } from '../src/modules/auth/session.model.js';
import { User } from '../src/modules/users/user.model.js';
import { bearer, createUser, extractRefreshCookie, login, TEST_PASSWORD } from './helpers.js';

const app = createApp();

describe('POST /auth/login', () => {
  it('returns an access token, the user and permissions, and sets a secure refresh cookie', async () => {
    const user = await createUser({ role: 'inventory_manager', email: 'Marcus@StockFlow.test' });
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: ' MARCUS@stockflow.test ', password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.user).toMatchObject({ id: user.id, role: 'inventory_manager' });
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
    expect(res.body.data.permissions).toContain('products:write');
    expect(res.body.data.permissions).not.toContain('users:manage');

    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('sf_refresh='),
    )!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);

    const stored = await User.findById(user.id).lean();
    expect(stored?.lastLoginAt).toBeInstanceOf(Date);
  });

  it('gives the same error for an unknown email and a wrong password', async () => {
    const user = await createUser();
    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'not-the-password' });
    const unknownEmail = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@stockflow.test', password: 'not-the-password' });

    for (const res of [wrongPassword, unknownEmail]) {
      expect(res.status).toBe(401);
      expect(res.body.error).toEqual({
        code: 'INVALID_CREDENTIALS',
        message: 'Incorrect email or password',
      });
    }
  });

  it('rejects deactivated accounts', async () => {
    const user = await createUser({ isActive: false });
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('validates the request body', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(
      expect.arrayContaining(['email', 'password']),
    );
  });

  it('rate-limits repeated failed attempts for the same email', async () => {
    const user = await createUser();
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'wrong-password' });
      expect(res.status).toBe(401);
    }
    const blocked = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('access tokens', () => {
  it('authenticates /auth/me with a bearer token', async () => {
    const user = await createUser({ role: 'sales_manager' });
    const { accessToken } = await login(app, user.email);
    const res = await request(app).get('/api/v1/auth/me').set(bearer(accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(user.email);
    expect(res.body.data.permissions).toEqual(
      expect.arrayContaining(['customers:write', 'salesOrders:write']),
    );
  });

  it('rejects missing, malformed and wrongly signed tokens', async () => {
    const user = await createUser();
    const forged = jwt.sign({ role: 'admin' }, 'a-different-secret-of-sufficient-length', {
      subject: user.id,
      issuer: 'stockflow',
    });
    for (const headers of [{}, bearer('garbage'), bearer(forged)]) {
      const res = await request(app).get('/api/v1/auth/me').set(headers);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('reports expired tokens with TOKEN_EXPIRED so the client can refresh', async () => {
    const user = await createUser();
    const expired = jwt.sign(
      { role: 'staff', exp: Math.floor(Date.now() / 1000) - 60 },
      process.env.JWT_ACCESS_SECRET!,
      { subject: user.id, issuer: 'stockflow' },
    );
    const res = await request(app).get('/api/v1/auth/me').set(bearer(expired));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('stops accepting a token as soon as the user is deactivated', async () => {
    const user = await createUser();
    const { accessToken } = await login(app, user.email);
    await User.updateOne({ _id: user.id }, { isActive: false });
    const res = await request(app).get('/api/v1/auth/me').set(bearer(accessToken));
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the refresh token and issues a new access token', async () => {
    const user = await createUser();
    const session = await login(app, user.email);

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', session.refreshCookie);
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(user.id);
    const rotated = extractRefreshCookie(res.headers['set-cookie']);
    expect(rotated).not.toBe(session.refreshCookie);

    const me = await request(app).get('/api/v1/auth/me').set(bearer(res.body.data.accessToken));
    expect(me.status).toBe(200);
  });

  it('requires a refresh cookie', async () => {
    const res = await request(app).post('/api/v1/auth/refresh');
    expect(res.status).toBe(401);
  });

  it('tolerates a concurrent reuse within the grace window', async () => {
    const user = await createUser();
    const session = await login(app, user.email);
    const first = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', session.refreshCookie);
    const second = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', session.refreshCookie);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it('revokes the whole session family when a rotated token is reused later', async () => {
    const user = await createUser();
    const session = await login(app, user.email);
    const rotatedRes = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', session.refreshCookie);
    const rotated = extractRefreshCookie(rotatedRes.headers['set-cookie']);

    // Move the original token's revocation outside the grace window.
    await Session.updateMany(
      { userId: user.id, revokedAt: { $ne: null } },
      { revokedAt: new Date(Date.now() - 60_000) },
    );

    const reuse = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', session.refreshCookie);
    expect(reuse.status).toBe(401);
    expect(reuse.headers['set-cookie']?.[0]).toMatch(/sf_refresh=;/);

    const afterTheft = await request(app).post('/api/v1/auth/refresh').set('Cookie', rotated);
    expect(afterTheft.status).toBe(401);
  });

  it('refuses to refresh for a deactivated user', async () => {
    const user = await createUser();
    const session = await login(app, user.email);
    await User.updateOne({ _id: user.id }, { isActive: false });
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', session.refreshCookie);
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('revokes the session and clears the cookie', async () => {
    const user = await createUser();
    const session = await login(app, user.email);

    const res = await request(app).post('/api/v1/auth/logout').set('Cookie', session.refreshCookie);
    expect(res.status).toBe(204);
    expect(res.headers['set-cookie']?.[0]).toMatch(/sf_refresh=;/);

    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', session.refreshCookie);
    expect(refresh.status).toBe(401);
  });
});

describe('password change', () => {
  it('blocks other endpoints until a required password change is done', async () => {
    const user = await createUser({ role: 'admin', mustChangePassword: true });
    const session = await login(app, user.email);
    expect(session.body.user.mustChangePassword).toBe(true);

    const blocked = await request(app).get('/api/v1/users').set(bearer(session.accessToken));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const me = await request(app).get('/api/v1/auth/me').set(bearer(session.accessToken));
    expect(me.status).toBe(200);

    const change = await request(app)
      .post('/api/v1/auth/change-password')
      .set(bearer(session.accessToken))
      .set('Cookie', session.refreshCookie)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'a-brand-new-password' });
    expect(change.status).toBe(200);
    expect(change.body.data.mustChangePassword).toBe(false);

    const allowed = await request(app).get('/api/v1/users').set(bearer(session.accessToken));
    expect(allowed.status).toBe(200);

    await login(app, user.email, 'a-brand-new-password');
  });

  it('rejects an incorrect current password with a field error', async () => {
    const user = await createUser();
    const session = await login(app, user.email);
    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set(bearer(session.accessToken))
      .send({ currentPassword: 'wrong-password', newPassword: 'a-brand-new-password' });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      { path: 'currentPassword', message: 'Current password is incorrect' },
    ]);
  });

  it('signs out other sessions but keeps the current one', async () => {
    const user = await createUser();
    const current = await login(app, user.email);
    const other = await login(app, user.email);

    await request(app)
      .post('/api/v1/auth/change-password')
      .set(bearer(current.accessToken))
      .set('Cookie', current.refreshCookie)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'a-brand-new-password' })
      .expect(200);

    const otherRefresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', other.refreshCookie);
    expect(otherRefresh.status).toBe(401);
    const currentRefresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', current.refreshCookie);
    expect(currentRefresh.status).toBe(200);
  });
});
