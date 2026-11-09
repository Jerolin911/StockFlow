import { Router, type RequestHandler } from 'express';
import swaggerUi from 'swagger-ui-express';
import { ROLE_LABELS, ROLE_PERMISSIONS, type Permission, type Role } from '@stockflow/shared';
import { z } from 'zod';
import { accessOf, type AccessRequirement } from '../../middleware/auth.js';
import { OPERATIONS, TAGS, type OperationDoc } from './catalog.js';

export type Mount = [prefix: string, router: Router];

interface Layer {
  handle: RequestHandler;
  route?: { path: string; methods: Record<string, boolean>; stack: Layer[] };
}

export interface DiscoveredRoute {
  key: string;
  method: string;
  path: string;
  prefix: string;
  access: AccessRequirement;
}

function merge(into: AccessRequirement, handler: unknown) {
  const access = accessOf(handler);
  if (access?.authenticated) into.authenticated = true;
  if (access?.permissions) into.permissions = [...(into.permissions ?? []), ...access.permissions];
}

/** Every route the API actually serves, read from the mounted routers, with its guards. */
export function discoverRoutes(mounts: Mount[]): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = [];
  for (const [prefix, router] of mounts) {
    const routerAccess: AccessRequirement = {};
    for (const layer of (router as unknown as { stack: Layer[] }).stack) {
      if (!layer.route) {
        merge(routerAccess, layer.handle);
        continue;
      }
      const path = prefix + (layer.route.path === '/' ? '' : layer.route.path);
      for (const method of Object.keys(layer.route.methods)) {
        const access: AccessRequirement = {
          ...routerAccess,
          permissions: [...(routerAccess.permissions ?? [])],
        };
        for (const handler of layer.route.stack) merge(access, handler.handle);
        routes.push({ key: `${method.toUpperCase()} ${path}`, method, path, prefix, access });
      }
    }
  }
  return routes;
}

const jsonSchema = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any', target: 'openapi-3.0' }) as {
    properties?: Record<string, object & { description?: string }>;
    required?: string[];
  };

const rolesWith = (permission: Permission) =>
  (Object.keys(ROLE_PERMISSIONS) as Role[])
    .filter((role) => (ROLE_PERMISSIONS[role] as readonly Permission[]).includes(permission))
    .map((role) => ROLE_LABELS[role]);

const ref = (name: string) => ({ $ref: `#/components/responses/${name}` });

function operation(route: DiscoveredRoute, doc: OperationDoc, tag: string) {
  const pathParams = [...route.path.matchAll(/:(\w+)/g)].map((m) => m[1]!);
  const parameters: object[] = pathParams.map((name) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string', pattern: '^[a-f0-9]{24}$' },
  }));
  if (doc.query) {
    const query = jsonSchema(doc.query);
    for (const [name, schema] of Object.entries(query.properties ?? {})) {
      parameters.push({ name, in: 'query', required: query.required?.includes(name), schema });
    }
  }

  const notes: string[] = [];
  if (doc.description) notes.push(doc.description);
  const permissions = [...new Set(route.access.permissions ?? [])];
  if (permissions.length > 0) {
    notes.push(
      `**Requires:** ${permissions
        .map((p) => `\`${p}\` (${rolesWith(p).join(', ')})`)
        .join(' and ')}.`,
    );
  } else if (route.access.authenticated) {
    notes.push('**Requires:** any signed-in user.');
  }

  const responses: Record<string, object> = {
    '2XX': ref(route.method === 'get' && !pathParams.length ? 'List' : 'Data'),
  };
  if (doc.body || doc.query) responses['400'] = ref('ValidationError');
  if (route.access.authenticated) responses['401'] = ref('Unauthenticated');
  if (permissions.length > 0 || route.access.authenticated) responses['403'] = ref('Forbidden');
  if (pathParams.length > 0) responses['404'] = ref('NotFound');
  if (route.method !== 'get') responses['409'] = ref('Conflict');

  return {
    tags: [tag],
    summary: doc.summary,
    ...(notes.length > 0 ? { description: notes.join('\n\n') } : {}),
    operationId: route.key.replace(/[^\w]+/g, '_').replace(/_+$/, ''),
    ...(route.access.authenticated ? { security: [{ bearerAuth: [] }] } : { security: [] }),
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(doc.body
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: jsonSchema(doc.body) } },
          },
        }
      : {}),
    responses,
  };
}

const errorBody = (code: string, example: string) => ({
  description: example,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Error' },
      example: { error: { code, message: example } },
    },
  },
});

export function buildOpenApi(mounts: Mount[]) {
  const paths: Record<string, Record<string, object>> = {};
  for (const route of discoverRoutes(mounts)) {
    const doc = OPERATIONS[route.key];
    if (!doc) throw new Error(`No OpenAPI entry for ${route.key}; add it to docs/catalog.ts`);
    const tag = TAGS.find((t) => t.prefix === route.prefix)?.name ?? 'Other';
    const path = route.path.replace(/:(\w+)/g, '{$1}');
    (paths[path] ??= {})[route.method] = operation(route, doc, tag);
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'StockFlow API',
      version: '1.0.0',
      description: [
        'Inventory, procurement, warehouse operations and order fulfilment.',
        '',
        '1. `POST /auth/login` with a seeded account (for example `admin@stockflow.test`).',
        '2. Copy `data.accessToken`, press **Authorize** and paste it.',
        '',
        'Money is in integer minor units (cents), rates in basis points (1% = 100) and quantities are integers. Lists take `page` and `pageSize` and return `meta.total`.',
      ].join('\n'),
    },
    servers: [{ url: '/api/v1' }],
    tags: TAGS.map(({ name, description }) => ({ name, description })),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                details: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { path: { type: 'string' }, message: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
      responses: {
        Data: {
          description: 'Success',
          content: {
            'application/json': {
              schema: { type: 'object', properties: { data: { type: 'object' } } },
            },
          },
        },
        List: {
          description: 'A page of results (or CSV when `format=csv` is supported)',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { type: 'array', items: { type: 'object' } },
                  meta: {
                    type: 'object',
                    properties: {
                      page: { type: 'integer' },
                      pageSize: { type: 'integer' },
                      total: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
        ValidationError: {
          description: 'Invalid input; `details` lists each field',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: {
                error: {
                  code: 'VALIDATION_ERROR',
                  message: 'Invalid request',
                  details: [
                    { path: 'lines.0.quantity', message: 'Too small: expected number to be >0' },
                  ],
                },
              },
            },
          },
        },
        Unauthenticated: errorBody('UNAUTHENTICATED', 'Missing, invalid or expired access token'),
        Forbidden: errorBody('FORBIDDEN', 'Your role lacks the permission'),
        NotFound: errorBody('NOT_FOUND', 'Record not found'),
        Conflict: errorBody('INVALID_STATE', 'Not allowed in the current state or would oversell'),
      },
    },
  };
}

/** `/openapi.json` and the Swagger UI at `/docs`. */
export function createDocsRouter(spec: object): Router {
  const router = Router();
  router.get('/openapi.json', (_req, res) => {
    res.json(spec);
  });
  router.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(spec, {
      customSiteTitle: 'StockFlow API',
      swaggerOptions: { persistAuthorization: true, docExpansion: 'none', tagsSorter: undefined },
    }),
  );
  return router;
}
