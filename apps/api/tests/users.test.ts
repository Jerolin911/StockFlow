import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ROLES } from '@stockflow/shared';
import { createApp } from '../src/app.js';
import { bearer, createAndLogin, createUser, login, TEST_PASSWORD } from './helpers.js';

const app = createApp();

describe('users RBAC', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/users');
    expect(res.status).toBe(401);
  });

  it.each(ROLES.filter((role) => role !== 'admin'))(
    'denies %s access to user management',
    async (role) => {
      const { accessToken } = await createAndLogin(app, role);
      const list = await request(app).get('/api/v1/users').set(bearer(accessToken));
      expect(list.status).toBe(403);
      expect(list.body.error.code).toBe('FORBIDDEN');

      const create = await request(app).post('/api/v1/users').set(bearer(accessToken)).send({
        name: 'X',
        email: 'x@stockflow.test',
        role: 'admin',
        password: 'long-enough-password',
      });
      expect(create.status).toBe(403);
    },
  );

  it('applies a role change to an existing token immediately', async () => {
    const admin = await createAndLogin(app, 'admin');
    const staff = await createAndLogin(app, 'staff');
    await request(app).get('/api/v1/users').set(bearer(staff.accessToken)).expect(403);

    await request(app)
      .patch(`/api/v1/users/${staff.user.id}`)
      .set(bearer(admin.accessToken))
      .send({ role: 'admin' })
      .expect(200);

    await request(app).get('/api/v1/users').set(bearer(staff.accessToken)).expect(200);
  });
});

describe('user management', () => {
  it('creates a user who must change the temporary password', async () => {
    const admin = await createAndLogin(app, 'admin');
    const res = await request(app).post('/api/v1/users').set(bearer(admin.accessToken)).send({
      name: '  Priya Nair ',
      email: 'Priya@StockFlow.test',
      role: 'procurement_manager',
      password: 'temporary-password',
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: 'Priya Nair',
      email: 'priya@stockflow.test',
      role: 'procurement_manager',
      isActive: true,
      mustChangePassword: true,
      lastLoginAt: null,
    });
    expect(res.body.data).not.toHaveProperty('passwordHash');

    const session = await login(app, 'priya@stockflow.test', 'temporary-password');
    expect(session.body.user.mustChangePassword).toBe(true);
  });

  it('rejects duplicate emails and invalid input', async () => {
    const admin = await createAndLogin(app, 'admin');
    const existing = await createUser();

    const duplicate = await request(app).post('/api/v1/users').set(bearer(admin.accessToken)).send({
      name: 'Dup',
      email: existing.email.toUpperCase(),
      role: 'staff',
      password: 'long-enough-password',
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.details[0].path).toBe('email');

    const invalid = await request(app)
      .post('/api/v1/users')
      .set(bearer(admin.accessToken))
      .send({ name: '', email: 'bad', role: 'owner', password: 'short' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual([
      'email',
      'name',
      'password',
      'role',
    ]);
  });

  it('lists users with search, filters, sorting and pagination', async () => {
    const admin = await createAndLogin(app, 'admin');
    await createUser({ name: 'Alice Archer', role: 'sales_manager' });
    await createUser({ name: 'Bob Baker', role: 'sales_manager', isActive: false });
    await createUser({ name: 'Carla Cruz', role: 'staff' });

    const sales = await request(app)
      .get('/api/v1/users?role=sales_manager&sort=name')
      .set(bearer(admin.accessToken));
    expect(sales.body.data.map((u: { name: string }) => u.name)).toEqual([
      'Alice Archer',
      'Bob Baker',
    ]);
    expect(sales.body.meta).toEqual({ page: 1, pageSize: 25, total: 2 });

    const active = await request(app)
      .get('/api/v1/users?role=sales_manager&status=active')
      .set(bearer(admin.accessToken));
    expect(active.body.data).toHaveLength(1);

    const search = await request(app)
      .get('/api/v1/users?search=carla')
      .set(bearer(admin.accessToken));
    expect(search.body.data.map((u: { name: string }) => u.name)).toEqual(['Carla Cruz']);

    const regexSafe = await request(app)
      .get('/api/v1/users?search=.*')
      .set(bearer(admin.accessToken));
    expect(regexSafe.body.meta.total).toBe(0);

    const page2 = await request(app)
      .get('/api/v1/users?sort=-name&pageSize=2&page=2')
      .set(bearer(admin.accessToken));
    expect(page2.body.meta).toEqual({ page: 2, pageSize: 2, total: 4 });
    expect(page2.body.data).toHaveLength(2);

    const badSort = await request(app)
      .get('/api/v1/users?sort=passwordHash')
      .set(bearer(admin.accessToken));
    expect(badSort.status).toBe(400);
  });

  it('returns 404 for unknown and malformed ids', async () => {
    const admin = await createAndLogin(app, 'admin');
    for (const id of ['000000000000000000000000', 'not-an-id']) {
      const res = await request(app).get(`/api/v1/users/${id}`).set(bearer(admin.accessToken));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });

  it('updates name, email and role', async () => {
    const admin = await createAndLogin(app, 'admin');
    const user = await createUser({ role: 'staff' });
    const res = await request(app)
      .patch(`/api/v1/users/${user.id}`)
      .set(bearer(admin.accessToken))
      .send({ name: 'Amara Okafor', email: 'amara@stockflow.test', role: 'inventory_manager' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      name: 'Amara Okafor',
      email: 'amara@stockflow.test',
      role: 'inventory_manager',
    });
  });

  it('prevents admins from changing their own role or deactivating themselves', async () => {
    const admin = await createAndLogin(app, 'admin');
    const role = await request(app)
      .patch(`/api/v1/users/${admin.user.id}`)
      .set(bearer(admin.accessToken))
      .send({ role: 'staff' });
    expect(role.status).toBe(409);

    const deactivate = await request(app)
      .patch(`/api/v1/users/${admin.user.id}`)
      .set(bearer(admin.accessToken))
      .send({ isActive: false });
    expect(deactivate.status).toBe(409);

    const rename = await request(app)
      .patch(`/api/v1/users/${admin.user.id}`)
      .set(bearer(admin.accessToken))
      .send({ name: 'Renamed Admin' });
    expect(rename.status).toBe(200);
  });

  it('deactivating a user ends their sessions and blocks sign-in', async () => {
    const admin = await createAndLogin(app, 'admin');
    const user = await createUser();
    const session = await login(app, user.email);

    await request(app)
      .patch(`/api/v1/users/${user.id}`)
      .set(bearer(admin.accessToken))
      .send({ isActive: false })
      .expect(200);

    await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', session.refreshCookie)
      .expect(401);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(403);

    await request(app)
      .patch(`/api/v1/users/${user.id}`)
      .set(bearer(admin.accessToken))
      .send({ isActive: true })
      .expect(200);
    await login(app, user.email);
  });

  it('resets a password, requiring a change and ending existing sessions', async () => {
    const admin = await createAndLogin(app, 'admin');
    const user = await createUser();
    const session = await login(app, user.email);

    const res = await request(app)
      .post(`/api/v1/users/${user.id}/reset-password`)
      .set(bearer(admin.accessToken))
      .send({ password: 'reset-temporary-pass' });
    expect(res.status).toBe(200);
    expect(res.body.data.mustChangePassword).toBe(true);

    await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', session.refreshCookie)
      .expect(401);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(401);
    const fresh = await login(app, user.email, 'reset-temporary-pass');
    expect(fresh.body.user.mustChangePassword).toBe(true);

    const self = await request(app)
      .post(`/api/v1/users/${admin.user.id}/reset-password`)
      .set(bearer(admin.accessToken))
      .send({ password: 'reset-temporary-pass' });
    expect(self.status).toBe(409);
  });

  it('reports user counts by role', async () => {
    const admin = await createAndLogin(app, 'admin');
    await createUser({ role: 'staff' });
    await createUser({ role: 'staff' });
    await createUser({ role: 'sales_manager', isActive: false });

    const res = await request(app).get('/api/v1/users/stats').set(bearer(admin.accessToken));
    expect(res.body.data).toEqual({
      total: 4,
      active: 3,
      inactive: 1,
      activeByRole: {
        admin: 1,
        inventory_manager: 0,
        procurement_manager: 0,
        sales_manager: 0,
        staff: 2,
      },
    });
  });
});
