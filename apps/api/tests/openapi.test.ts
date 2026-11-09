import SwaggerParser from '@apidevtools/swagger-parser';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS, type Permission, type Role } from '@stockflow/shared';
import { apiMounts, createApp } from '../src/app.js';
import { OPERATIONS } from '../src/modules/docs/catalog.js';
import { buildOpenApi, discoverRoutes } from '../src/modules/docs/openapi.js';
import { tokenFor } from './fixtures.js';

const app = createApp();
const routes = discoverRoutes(apiMounts());
const SOME_ID = '0123456789abcdef01234567';

describe('OpenAPI document', () => {
  it('documents exactly the routes the API serves', () => {
    const live = routes.map((r) => r.key).sort();
    expect(new Set(live).size).toBe(live.length);
    expect(Object.keys(OPERATIONS).sort()).toEqual(live);
    expect(live.length).toBeGreaterThan(120);
  });

  it('is a valid OpenAPI 3 document', async () => {
    const spec = buildOpenApi(apiMounts());
    await expect(SwaggerParser.validate(structuredClone(spec) as never)).resolves.toBeTruthy();
  });

  it('reads guards from the routers: public, signed in, or permission', () => {
    const find = (key: string) => routes.find((r) => r.key === key)!.access;
    expect(find('POST /auth/login').authenticated).toBeUndefined();
    expect(find('GET /health').authenticated).toBeUndefined();
    expect(find('GET /auth/me').authenticated).toBe(true);
    expect(find('GET /products').permissions).toEqual([]);
    expect(find('POST /purchase-orders/:id/approve').permissions).toEqual([
      'purchaseOrders:approve',
    ]);
    expect(find('GET /users').permissions).toEqual(['users:manage']);
    expect(find('POST /suppliers').permissions).toEqual(['suppliers:write']);
  });

  it('every documented permission is enforced: a role without it gets 403', async () => {
    const tokens = new Map<Role, string>();
    let checked = 0;
    for (const route of routes) {
      const required = route.access.permissions ?? [];
      if (required.length === 0) continue;
      const role = (Object.keys(ROLE_PERMISSIONS) as Role[]).find(
        (r) => !required.every((p) => (ROLE_PERMISSIONS[r] as readonly Permission[]).includes(p)),
      );
      if (!role) continue;
      if (!tokens.has(role)) tokens.set(role, await tokenFor(app, role));
      const path = `/api/v1${route.path.replace(/:\w+/g, SOME_ID)}`;
      const agent = request(app);
      const res = await agent[route.method as 'get' | 'post'](path)
        .set('Authorization', `Bearer ${tokens.get(role)}`)
        .send({});
      expect(res.status, `${route.key} as ${role}`).toBe(403);
      checked++;
    }
    expect(checked).toBeGreaterThan(60);
  });

  it('serves the JSON document and the Swagger UI', async () => {
    const json = await request(app).get('/api/v1/openapi.json').expect(200);
    expect(json.body.paths['/purchase-orders/{id}/approve'].post.description).toContain(
      '`purchaseOrders:approve` (',
    );
    expect(json.body.paths['/goods-receipts'].post.requestBody).toBeTruthy();
    const ui = await request(app).get('/api/v1/docs/').expect(200);
    expect(ui.text).toContain('swagger-ui');
  });
});
