import { Router, type Response } from 'express';
import {
  MOVEMENT_CLASS_LABELS,
  SALES_ORDER_STATUS_LABELS,
  availabilityReportQuerySchema,
  hasPermission,
  reportRangeSchema,
  reportTableQuerySchema,
  salesOrdersReportQuerySchema,
  trendQuerySchema,
  velocityQuerySchema,
  type TrendDto,
} from '@stockflow/shared';
import { authenticate, authorize, requireAuth } from '../../middleware/auth.js';
import { decimal, dateOnly, sendCsv, sendTable, type CsvColumn } from './common.js';
import {
  availability,
  categoryReport,
  movementTrend,
  overview,
  velocity,
  warehouseStock,
} from './inventory.js';
import { deliveries, pendingPurchases, purchaseTrend, supplierPerformance } from './purchasing.js';
import { fulfilmentStats, salesOrdersReport, salesTrend, topProducts } from './sales.js';

const MONEY_SERIES = new Set(['value']);

/** A trend as JSON, or as CSV with one row per period. */
function sendTrend(res: Response, format: unknown, filename: string, trend: TrendDto) {
  if (format !== 'csv') {
    res.json({ data: trend });
    return;
  }
  sendCsv(
    res,
    filename,
    [
      { header: 'Period starting', value: (p) => p.period },
      ...trend.series.map((s) => ({
        header: s.label,
        value: (p: TrendDto['points'][number]) =>
          MONEY_SERIES.has(s.key) ? decimal(p.values[s.key] ?? 0) : (p.values[s.key] ?? 0),
      })),
    ],
    trend.points,
  );
}

const product = <T extends { product: { sku: string; name: string } }>(): CsvColumn<T>[] => [
  { header: 'SKU', value: (r) => r.product.sku },
  { header: 'Product', value: (r) => r.product.name },
];

export function createReportsRouter(): Router {
  const router = Router();
  router.use(authenticate());

  router.get('/overview', async (req, res) => {
    const { user } = requireAuth(req);
    res.json({ data: await overview(hasPermission(user.role, 'reports:inventory')) });
  });

  // Inventory

  const inventory = authorize('reports:inventory');

  router.get('/inventory/movement-trend', inventory, async (req, res) => {
    sendTrend(
      res,
      req.query.format,
      'stock-movements',
      await movementTrend(trendQuerySchema.parse(req.query)),
    );
  });

  router.get('/inventory/velocity', inventory, async (req, res) => {
    const query = velocityQuerySchema.parse(req.query);
    sendTable(res, query, await velocity(query), {
      filename: 'product-movement',
      columns: [
        ...product(),
        { header: 'Category', value: (r) => r.product.category?.name },
        { header: 'Movement', value: (r) => MOVEMENT_CLASS_LABELS[r.movement] },
        { header: 'Units shipped', value: (r) => r.unitsOut },
        { header: 'Units received', value: (r) => r.unitsIn },
        { header: 'Per day', value: (r) => r.dailyRate },
        { header: 'On hand', value: (r) => r.onHand },
        { header: 'Days of cover', value: (r) => r.daysOfCover },
      ],
    });
  });

  router.get('/inventory/warehouses', inventory, async (req, res) => {
    reportRangeSchema.parse(req.query);
    const rows = await warehouseStock(true);
    if (req.query.format === 'csv') {
      sendCsv(
        res,
        'warehouse-stock',
        [
          { header: 'Code', value: (r) => r.warehouse.code },
          { header: 'Warehouse', value: (r) => r.warehouse.name },
          { header: 'Active', value: (r) => (r.warehouse.isActive ? 'Yes' : 'No') },
          { header: 'Products held', value: (r) => r.skus },
          { header: 'On hand', value: (r) => r.onHand },
          { header: 'Reserved', value: (r) => r.reserved },
          { header: 'Available', value: (r) => r.available },
          { header: 'Quarantine', value: (r) => r.quarantine },
          { header: 'Value', value: (r) => decimal(r.value) },
          { header: 'Low stock', value: (r) => r.lowStock },
          { header: 'Out of stock', value: (r) => r.outOfStock },
        ],
        rows,
      );
      return;
    }
    res.json({ data: rows });
  });

  router.get('/inventory/availability', inventory, async (req, res) => {
    const query = availabilityReportQuerySchema.parse(req.query);
    sendTable(res, query, await availability(query), {
      filename: 'inventory-availability',
      columns: [
        ...product(),
        { header: 'Category', value: (r) => r.product.category?.name },
        { header: 'On hand', value: (r) => r.onHand },
        { header: 'Reserved', value: (r) => r.reserved },
        { header: 'Available', value: (r) => r.available },
        { header: 'Quarantine', value: (r) => r.quarantine },
        { header: 'Incoming', value: (r) => r.incoming },
        { header: 'In transit', value: (r) => r.inTransit },
        { header: 'Reorder point', value: (r) => r.reorderPoint },
        { header: 'Status', value: (r) => r.status },
      ],
    });
  });

  router.get('/inventory/categories', inventory, async (req, res) => {
    const query = trendQuerySchema.parse(req.query);
    const rows = await categoryReport(query);
    if (req.query.format === 'csv') {
      sendCsv(
        res,
        'categories',
        [
          { header: 'Category', value: (r) => r.category?.name },
          { header: 'Products', value: (r) => r.products },
          { header: 'On hand', value: (r) => r.onHand },
          { header: 'Available', value: (r) => r.available },
          { header: 'Value', value: (r) => decimal(r.value) },
          { header: 'Units received', value: (r) => r.unitsIn },
          { header: 'Units shipped', value: (r) => r.unitsOut },
        ],
        rows,
      );
      return;
    }
    res.json({ data: rows });
  });

  // Purchasing

  const purchasing = authorize('reports:purchasing');

  router.get('/purchasing/trend', purchasing, async (req, res) => {
    sendTrend(
      res,
      req.query.format,
      'purchase-orders',
      await purchaseTrend(trendQuerySchema.parse(req.query)),
    );
  });

  router.get('/purchasing/suppliers', purchasing, async (req, res) => {
    const query = reportTableQuerySchema.parse(req.query);
    sendTable(res, query, await supplierPerformance(query), {
      filename: 'supplier-performance',
      columns: [
        { header: 'Code', value: (r) => r.supplier.code },
        { header: 'Supplier', value: (r) => r.supplier.name },
        { header: 'Orders', value: (r) => r.orders },
        { header: 'Value ordered', value: (r) => decimal(r.orderedValue) },
        { header: 'Deliveries', value: (r) => r.receipts },
        { header: 'On time', value: (r) => r.onTime },
        { header: 'Late', value: (r) => r.late },
        { header: 'On-time rate', value: (r) => r.onTimeRate },
        { header: 'Average days late', value: (r) => r.averageDaysLate },
        { header: 'Accepted units', value: (r) => r.acceptedUnits },
        { header: 'Rejected units', value: (r) => r.rejectedUnits },
        { header: 'Damaged units', value: (r) => r.damagedUnits },
        { header: 'Issue rate', value: (r) => r.issueRate },
        { header: 'Open orders', value: (r) => r.openOrders },
        { header: 'Overdue orders', value: (r) => r.overdueOrders },
      ],
    });
  });

  router.get('/purchasing/deliveries', purchasing, async (req, res) => {
    const query = reportTableQuerySchema.parse(req.query);
    const csv = query.format === 'csv';
    const result = await deliveries(query, csv);
    if (!csv) {
      res.json(result);
      return;
    }
    sendCsv(
      res,
      'supplier-deliveries',
      [
        { header: 'Receipt', value: (r) => r.receipt.number },
        { header: 'Purchase order', value: (r) => r.purchaseOrder.number },
        { header: 'Supplier', value: (r) => r.supplier.name },
        { header: 'Warehouse', value: (r) => r.warehouse.code },
        { header: 'Received', value: (r) => dateOnly(r.receivedAt) },
        { header: 'Expected', value: (r) => r.expectedDate },
        { header: 'Days late', value: (r) => r.daysLate },
        { header: 'Accepted', value: (r) => r.acceptedUnits },
        { header: 'Rejected', value: (r) => r.rejectedUnits },
        { header: 'Damaged', value: (r) => r.damagedUnits },
      ],
      result.data,
    );
  });

  router.get('/purchasing/pending', purchasing, async (req, res) => {
    const query = reportTableQuerySchema.parse(req.query);
    const csv = query.format === 'csv';
    const result = await pendingPurchases(query, csv);
    if (!csv) {
      res.json(result);
      return;
    }
    sendCsv(
      res,
      'pending-purchases',
      [
        { header: 'Purchase order', value: (r) => r.purchaseOrder.number },
        { header: 'Supplier', value: (r) => r.supplier.name },
        { header: 'Warehouse', value: (r) => r.warehouse.code },
        ...product(),
        { header: 'Ordered', value: (r) => r.ordered },
        { header: 'Received', value: (r) => r.received },
        { header: 'Pending', value: (r) => r.pending },
        { header: 'Expected', value: (r) => r.expectedDate },
        { header: 'Overdue', value: (r) => (r.isOverdue ? 'Yes' : 'No') },
      ],
      result.data,
    );
  });

  // Sales

  const sales = authorize('reports:fulfilment');

  router.get('/sales/trend', sales, async (req, res) => {
    sendTrend(
      res,
      req.query.format,
      'sales-orders',
      await salesTrend(trendQuerySchema.parse(req.query)),
    );
  });

  router.get('/sales/top-products', sales, async (req, res) => {
    const query = reportTableQuerySchema.parse(req.query);
    sendTable(res, query, await topProducts(query), {
      filename: 'top-products',
      columns: [
        ...product(),
        { header: 'Category', value: (r) => r.product.category?.name },
        { header: 'Units shipped', value: (r) => r.unitsShipped },
        { header: 'Orders', value: (r) => r.orders },
        { header: 'Revenue (net)', value: (r) => decimal(r.revenue) },
        { header: 'Cost', value: (r) => decimal(r.cost) },
      ],
    });
  });

  router.get('/sales/fulfilment', sales, async (req, res) => {
    res.json({ data: await fulfilmentStats(reportTableQuerySchema.parse(req.query)) });
  });

  router.get('/sales/orders', sales, async (req, res) => {
    const query = salesOrdersReportQuerySchema.parse(req.query);
    const csv = query.format === 'csv';
    const result = await salesOrdersReport(query, csv);
    if (!csv) {
      res.json(result);
      return;
    }
    sendCsv(
      res,
      'sales-orders',
      [
        { header: 'Order', value: (r) => r.salesOrder.number },
        { header: 'Customer', value: (r) => r.customer.name },
        { header: 'Warehouse', value: (r) => r.warehouse.code },
        { header: 'Status', value: (r) => SALES_ORDER_STATUS_LABELS[r.status] },
        { header: 'Order date', value: (r) => dateOnly(r.orderDate) },
        { header: 'Required by', value: (r) => r.requiredDate },
        { header: 'Ordered', value: (r) => r.ordered },
        { header: 'Shipped', value: (r) => r.shipped },
        { header: 'Delivered', value: (r) => r.delivered },
        { header: 'Total', value: (r) => decimal(r.total) },
      ],
      result.data,
    );
  });

  return router;
}
