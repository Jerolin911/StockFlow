import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router, type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { pingDatabase } from './config/db.js';
import { logger } from './config/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { createCategoriesRouter } from './modules/categories/categories.js';
import { customers, suppliers } from './modules/partners/partners.js';
import { createProductsRouter } from './modules/products/products.js';
import { createSettingsRouter } from './modules/settings/settings.js';
import { createStockRouter } from './modules/stock/stock.routes.js';
import { createUsersRouter } from './modules/users/users.routes.js';
import { createWarehousesRouter } from './modules/warehouses/warehouses.js';

const REQUEST_ID_PATTERN = /^[\w-]{1,100}$/;

function parseTrustProxy(value: string): boolean | number | string {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', parseTrustProxy(env.TRUST_PROXY));

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id =
          typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming)
            ? incoming
            : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    }),
  );
  app.use(helmet());
  app.use(
    cors({ origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : false, credentials: true }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  const api = Router();
  api.get('/health', async (_req, res) => {
    const database = await pingDatabase();
    res.status(database ? 200 : 503).json({
      data: { status: database ? 'ok' : 'degraded', database: database ? 'up' : 'down' },
    });
  });
  api.use('/auth', createAuthRouter());
  api.use('/users', createUsersRouter());
  api.use('/settings', createSettingsRouter());
  api.use('/warehouses', createWarehousesRouter());
  api.use('/categories', createCategoriesRouter());
  api.use('/products', createProductsRouter());
  api.use('/suppliers', suppliers.router());
  api.use('/customers', customers.router());
  api.use('/stock', createStockRouter());

  app.use('/api/v1', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
