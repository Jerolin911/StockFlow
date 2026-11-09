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
import { createGoodsReceiptsRouter } from './modules/purchasing/goods-receipts.js';
import { createPurchaseOrdersRouter } from './modules/purchasing/purchase-orders.js';
import { createPurchaseRequestsRouter } from './modules/purchasing/purchase-requests.js';
import {
  createProductSupplierPricesRouter,
  createSupplierPurchasingRouter,
} from './modules/purchasing/supplier-prices.js';
import { createCustomerReturnsRouter } from './modules/returns/customer-returns.js';
import { createSupplierReturnsRouter } from './modules/returns/supplier-returns.js';
import { auditTrail, createAuditRouter } from './modules/audit/audit.js';
import { createNotificationsRouter } from './modules/notifications/notifications.js';
import { createReportsRouter } from './modules/reports/routes.js';
import { createSalesOrdersRouter } from './modules/sales/sales-orders.js';
import { createShipmentsRouter } from './modules/sales/shipments.js';
import { createSettingsRouter } from './modules/settings/settings.js';
import { createStockRouter } from './modules/stock/stock.routes.js';
import { createUsersRouter } from './modules/users/users.routes.js';
import { createStockCountsRouter } from './modules/warehouse-ops/stock-counts.js';
import { createWarehouseOpsRouter } from './modules/warehouse-ops/summary.js';
import { createTransfersRouter } from './modules/warehouse-ops/transfers.js';
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
  api.use(auditTrail());
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
  // Nested routers first so their paths aren't treated as unknown ids by the parent router.
  api.use('/products/:productId/supplier-prices', createProductSupplierPricesRouter());
  api.use('/products', createProductsRouter());
  api.use('/suppliers/:supplierId', createSupplierPurchasingRouter());
  api.use('/suppliers', suppliers.router());
  api.use('/customers', customers.router());
  api.use('/stock', createStockRouter());
  api.use('/purchase-requests', createPurchaseRequestsRouter());
  api.use('/purchase-orders', createPurchaseOrdersRouter());
  api.use('/goods-receipts', createGoodsReceiptsRouter());
  api.use('/sales-orders', createSalesOrdersRouter());
  api.use('/shipments', createShipmentsRouter());
  api.use('/stock-transfers', createTransfersRouter());
  api.use('/stock-counts', createStockCountsRouter());
  api.use('/customer-returns', createCustomerReturnsRouter());
  api.use('/supplier-returns', createSupplierReturnsRouter());
  api.use('/warehouse-ops', createWarehouseOpsRouter());
  api.use('/reports', createReportsRouter());
  api.use('/notifications', createNotificationsRouter());
  api.use('/audit-logs', createAuditRouter());

  app.use('/api/v1', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
