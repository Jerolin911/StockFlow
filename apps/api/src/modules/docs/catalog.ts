import * as s from '@stockflow/shared';
import type { z } from 'zod';

export interface OperationDoc {
  summary: string;
  description?: string;
  body?: z.ZodType;
  query?: z.ZodType;
}

/** Tag per mount prefix, in the order they appear in the documentation. */
export const TAGS: { prefix: string; name: string; description: string }[] = [
  { prefix: '/health', name: 'System', description: 'Liveness and database connectivity.' },
  {
    prefix: '/auth',
    name: 'Auth',
    description:
      'Sign in returns a 15-minute access token; send it as `Authorization: Bearer <token>`. A rotating refresh token is set as the httpOnly cookie `sf_refresh`.',
  },
  { prefix: '/users', name: 'Users', description: 'User accounts and roles (admin only).' },
  { prefix: '/settings', name: 'Settings', description: 'Company name, currency and defaults.' },
  { prefix: '/warehouses', name: 'Warehouses', description: 'Stock locations.' },
  { prefix: '/categories', name: 'Categories', description: 'Product categories.' },
  { prefix: '/products', name: 'Products', description: 'Product catalogue and supplier prices.' },
  {
    prefix: '/suppliers',
    name: 'Suppliers',
    description: 'Suppliers, price lists and deliveries.',
  },
  { prefix: '/customers', name: 'Customers', description: 'Customers.' },
  {
    prefix: '/stock',
    name: 'Stock',
    description:
      'Stock levels per product × warehouse, the movement ledger, adjustments, quarantine and opening stock.',
  },
  {
    prefix: '/purchase-requests',
    name: 'Purchase requests',
    description: 'Internal requests to buy, approved and converted into purchase orders.',
  },
  {
    prefix: '/purchase-orders',
    name: 'Purchase orders',
    description: 'Orders to suppliers: draft → pending approval → approved → received or closed.',
  },
  {
    prefix: '/goods-receipts',
    name: 'Goods receipts',
    description: 'Receiving against a purchase order. Only accepted units enter stock.',
  },
  {
    prefix: '/sales-orders',
    name: 'Sales orders',
    description: 'Customer orders. Confirming reserves stock for every line, all or nothing.',
  },
  {
    prefix: '/shipments',
    name: 'Shipments',
    description: 'Pick → pack → dispatch → delivered. Stock leaves on dispatch.',
  },
  {
    prefix: '/stock-transfers',
    name: 'Transfers',
    description: 'Moves between warehouses with approval, dispatch and partial receipt.',
  },
  { prefix: '/stock-counts', name: 'Stock counts', description: 'Physical counts and variances.' },
  {
    prefix: '/customer-returns',
    name: 'Customer returns',
    description: 'Returns received into quarantine, then inspected and restocked or written off.',
  },
  { prefix: '/supplier-returns', name: 'Supplier returns', description: 'Goods sent back.' },
  { prefix: '/warehouse-ops', name: 'Warehouse ops', description: 'Open warehouse work.' },
  {
    prefix: '/reports',
    name: 'Reports',
    description:
      'Read-only analytics over live records. Ranges default to the last 30 days; table reports accept `format=csv`.',
  },
  { prefix: '/notifications', name: 'Notifications', description: "The caller's inbox." },
  { prefix: '/audit-logs', name: 'Audit log', description: 'Changes and sign-in attempts.' },
];

const reason = s.reasonBodySchema;

/** Keyed by `METHOD /path` with Express-style parameters, relative to `/api/v1`. */
export const OPERATIONS: Record<string, OperationDoc> = {
  'GET /health': { summary: 'Check API and database health' },

  'POST /auth/login': {
    summary: 'Sign in',
    description:
      'Returns `{ accessToken, user }` and sets the refresh cookie. Rate limited per IP and per email.',
    body: s.loginSchema,
  },
  'POST /auth/refresh': {
    summary: 'Exchange the refresh cookie for a new access token',
    description: 'Rotates the refresh token. Reusing an old one revokes the whole session family.',
  },
  'POST /auth/logout': { summary: 'Sign out and revoke the refresh token' },
  'GET /auth/me': { summary: 'Current user and permissions' },
  'POST /auth/change-password': {
    summary: 'Change your password',
    description: 'Also allowed while a password change is required. Signs out other sessions.',
    body: s.changePasswordSchema,
  },

  'GET /users': { summary: 'List users', query: s.listUsersQuerySchema },
  'GET /users/stats': { summary: 'User counts by role and status' },
  'POST /users': {
    summary: 'Create a user',
    description: 'The user must change the given password at first sign-in.',
    body: s.createUserSchema,
  },
  'GET /users/:id': { summary: 'Get a user' },
  'PATCH /users/:id': {
    summary: 'Update name, role or active status',
    body: s.updateUserSchema,
  },
  'POST /users/:id/reset-password': {
    summary: 'Set a temporary password',
    body: s.resetPasswordSchema,
  },

  'GET /settings': { summary: 'Get workspace settings' },
  'PATCH /settings': { summary: 'Update workspace settings', body: s.updateSettingsSchema },

  'GET /warehouses': { summary: 'List warehouses', query: s.listWarehousesQuerySchema },
  'GET /warehouses/:id': { summary: 'Get a warehouse' },
  'POST /warehouses': { summary: 'Create a warehouse', body: s.createWarehouseSchema },
  'PATCH /warehouses/:id': { summary: 'Update a warehouse', body: s.updateWarehouseSchema },

  'GET /categories': { summary: 'List categories', query: s.listCategoriesQuerySchema },
  'POST /categories': { summary: 'Create a category', body: s.createCategorySchema },
  'PATCH /categories/:id': { summary: 'Update a category', body: s.updateCategorySchema },
  'DELETE /categories/:id': { summary: 'Delete an unused category' },

  'GET /products': { summary: 'List products', query: s.listProductsQuerySchema },
  'GET /products/:id': { summary: 'Get a product with stock per warehouse' },
  'POST /products': {
    summary: 'Create a product',
    description: 'The SKU is generated from the category prefix when omitted.',
    body: s.createProductSchema,
  },
  'PATCH /products/:id': { summary: 'Update a product', body: s.updateProductSchema },
  'GET /products/:productId/supplier-prices': { summary: "Suppliers' prices for a product" },

  'GET /suppliers': { summary: 'List suppliers', query: s.listPartnersQuerySchema },
  'GET /suppliers/:id': { summary: 'Get a supplier' },
  'POST /suppliers': { summary: 'Create a supplier', body: s.createSupplierSchema },
  'PATCH /suppliers/:id': { summary: 'Update a supplier', body: s.updateSupplierSchema },
  'GET /suppliers/:supplierId/prices': { summary: "A supplier's price list" },
  'PUT /suppliers/:supplierId/prices/:productId': {
    summary: 'Set the price a supplier charges for a product',
    body: s.supplierPriceSchema,
  },
  'DELETE /suppliers/:supplierId/prices/:productId': { summary: 'Remove a supplier price' },
  'GET /suppliers/:supplierId/delivery-summary': {
    summary: "A supplier's delivery history and on-time rate",
  },

  'GET /customers': { summary: 'List customers', query: s.listPartnersQuerySchema },
  'GET /customers/:id': { summary: 'Get a customer' },
  'POST /customers': { summary: 'Create a customer', body: s.createCustomerSchema },
  'PATCH /customers/:id': { summary: 'Update a customer', body: s.updateCustomerSchema },
  'POST /customers/:id/erase': {
    summary: "Erase a customer's personal data (destroys their data key)",
    body: s.eraseCustomerSchema,
  },

  'GET /stock/levels': {
    summary: 'Stock levels per product × warehouse',
    description:
      'On hand, reserved, available (on hand − reserved), quarantined and low-stock flag.',
    query: s.listStockLevelsQuerySchema,
  },
  'PATCH /stock/levels/:id': {
    summary: 'Set the low-stock threshold for one warehouse',
    body: s.updateThresholdSchema,
  },
  'GET /stock/availability': {
    summary: 'Available units for products, by warehouse',
    query: s.availabilityQuerySchema,
  },
  'GET /stock/movements': {
    summary: 'The stock movement ledger',
    description: 'Append-only. Every change to on-hand or quarantine has one entry.',
    query: s.listMovementsQuerySchema,
  },
  'GET /stock/adjustments': { summary: 'List adjustments', query: s.listAdjustmentsQuerySchema },
  'GET /stock/adjustments/:id': { summary: 'Get an adjustment' },
  'POST /stock/adjustments': {
    summary: 'Post an adjustment',
    description:
      'Each line has a signed quantity and a reason. Withdrawals cannot exceed available.',
    body: s.stockAdjustmentSchema,
  },
  'POST /stock/adjustments/:id/reverse': {
    summary: 'Reverse a posted adjustment',
    description: 'Posts the opposite quantities and links both documents. History is never edited.',
    body: s.reversalSchema,
  },
  'GET /stock/quarantine': {
    summary: 'Quarantined stock',
    query: s.listQuarantineQuerySchema,
  },
  'POST /stock/quarantine': {
    summary: 'Quarantine, release or write off units',
    body: s.quarantineActionSchema,
  },
  'POST /stock/opening': {
    summary: 'Record opening stock at a unit cost',
    body: s.openingStockSchema,
  },

  'GET /purchase-requests': {
    summary: 'List purchase requests',
    query: s.listPurchaseRequestsQuerySchema,
  },
  'GET /purchase-requests/:id': { summary: 'Get a purchase request' },
  'POST /purchase-requests': { summary: 'Create a draft request', body: s.purchaseRequestSchema },
  'PATCH /purchase-requests/:id': { summary: 'Edit a draft', body: s.purchaseRequestSchema },
  'DELETE /purchase-requests/:id': { summary: 'Delete a draft' },
  'POST /purchase-requests/:id/submit': { summary: 'Submit for approval' },
  'POST /purchase-requests/:id/approve': { summary: 'Approve' },
  'POST /purchase-requests/:id/reject': { summary: 'Reject with a reason', body: reason },
  'POST /purchase-requests/:id/cancel': {
    summary: 'Cancel (requester or approver)',
    body: reason,
  },
  'POST /purchase-requests/:id/convert': {
    summary: 'Convert approved lines into purchase orders per supplier',
    body: s.convertPurchaseRequestSchema,
  },

  'GET /purchase-orders': {
    summary: 'List purchase orders',
    query: s.listPurchaseOrdersQuerySchema,
  },
  'GET /purchase-orders/:id': { summary: 'Get a purchase order with receipt progress' },
  'POST /purchase-orders': { summary: 'Create a draft order', body: s.purchaseOrderSchema },
  'PATCH /purchase-orders/:id': { summary: 'Edit a draft', body: s.purchaseOrderSchema },
  'DELETE /purchase-orders/:id': { summary: 'Delete a draft' },
  'POST /purchase-orders/:id/submit': { summary: 'Submit for approval' },
  'POST /purchase-orders/:id/approve': { summary: 'Approve; the order can then be received' },
  'POST /purchase-orders/:id/reject': { summary: 'Reject back to draft', body: reason },
  'POST /purchase-orders/:id/cancel': {
    summary: 'Cancel an order with nothing received',
    body: reason,
  },
  'POST /purchase-orders/:id/close': {
    summary: 'Close a partly received order; the rest will not arrive',
    body: reason,
  },

  'GET /goods-receipts': { summary: 'List goods receipts', query: s.listGoodsReceiptsQuerySchema },
  'GET /goods-receipts/:id': { summary: 'Get a goods receipt' },
  'POST /goods-receipts': {
    summary: 'Post a goods receipt',
    description:
      'Per line: received, accepted, rejected and damaged units. Accepted units enter usable stock at the order price and update the average cost; damaged units go to quarantine.',
    body: s.goodsReceiptSchema,
  },

  'GET /sales-orders': { summary: 'List sales orders', query: s.listSalesOrdersQuerySchema },
  'GET /sales-orders/fulfilment-summary': { summary: 'Open fulfilment work by stage' },
  'GET /sales-orders/:id': { summary: 'Get a sales order with fulfilment progress' },
  'POST /sales-orders': {
    summary: 'Create a draft order',
    description:
      'Prices default to the product selling price; totals are recalculated by the server.',
    body: s.salesOrderSchema,
  },
  'PATCH /sales-orders/:id': { summary: 'Edit a draft', body: s.salesOrderSchema },
  'DELETE /sales-orders/:id': { summary: 'Delete a draft' },
  'POST /sales-orders/:id/confirm': {
    summary: 'Confirm and reserve stock',
    description: 'Fails with 409 `INSUFFICIENT_STOCK` and per-line details if any line is short.',
  },
  'POST /sales-orders/:id/cancel': {
    summary: 'Cancel and release unshipped reservations',
    body: reason,
  },

  'GET /shipments': { summary: 'List shipments', query: s.listShipmentsQuerySchema },
  'GET /shipments/:id': { summary: 'Get a shipment' },
  'POST /shipments': {
    summary: 'Create a pick list for an order',
    body: s.createShipmentSchema,
  },
  'POST /shipments/:id/pick': {
    summary: 'Confirm picked quantities (short picks allowed)',
    body: s.confirmPickSchema,
  },
  'POST /shipments/:id/pack': { summary: 'Record packing', body: s.packShipmentSchema },
  'POST /shipments/:id/dispatch': {
    summary: 'Dispatch: stock leaves the warehouse',
    body: s.dispatchShipmentSchema,
  },
  'POST /shipments/:id/tracking': {
    summary: 'Add a tracking event or mark delivered',
    body: s.trackingEventSchema,
  },
  'POST /shipments/:id/cancel': {
    summary: 'Cancel an undispatched shipment',
    body: reason,
  },

  'GET /stock-transfers': { summary: 'List transfers', query: s.listTransfersQuerySchema },
  'GET /stock-transfers/:id': { summary: 'Get a transfer' },
  'POST /stock-transfers': { summary: 'Request a transfer', body: s.transferSchema },
  'PATCH /stock-transfers/:id': { summary: 'Edit a requested transfer', body: s.transferSchema },
  'POST /stock-transfers/:id/approve': { summary: 'Approve' },
  'POST /stock-transfers/:id/reject': { summary: 'Reject', body: reason },
  'POST /stock-transfers/:id/cancel': { summary: 'Cancel before dispatch', body: reason },
  'POST /stock-transfers/:id/dispatch': {
    summary: 'Dispatch from the source warehouse',
    body: s.dispatchTransferSchema,
  },
  'POST /stock-transfers/:id/receive': {
    summary: 'Receive at the destination (partial allowed)',
    body: s.receiveTransferSchema,
  },
  'POST /stock-transfers/:id/close': {
    summary: 'Close short and write off what never arrived',
    body: reason,
  },

  'GET /stock-counts': { summary: 'List stock counts', query: s.listStockCountsQuerySchema },
  'GET /stock-counts/:id': { summary: 'Get a count with live variances' },
  'POST /stock-counts': {
    summary: 'Open a count for a warehouse',
    description: 'One open count per warehouse.',
    body: s.createStockCountSchema,
  },
  'PUT /stock-counts/:id/counts': {
    summary: 'Record counted quantities',
    body: s.recordCountsSchema,
  },
  'POST /stock-counts/:id/submit': { summary: 'Submit for posting' },
  'POST /stock-counts/:id/reopen': { summary: 'Reopen for recounting' },
  'POST /stock-counts/:id/post': {
    summary: 'Post variances as one adjustment',
    body: s.postStockCountSchema,
  },
  'POST /stock-counts/:id/cancel': { summary: 'Cancel', body: reason },

  'GET /customer-returns': {
    summary: 'List customer returns',
    query: s.listCustomerReturnsQuerySchema,
  },
  'GET /customer-returns/:id': { summary: 'Get a customer return' },
  'POST /customer-returns': {
    summary: 'Request a return against shipped order lines',
    body: s.customerReturnSchema,
  },
  'POST /customer-returns/:id/approve': { summary: 'Approve' },
  'POST /customer-returns/:id/reject': { summary: 'Reject', body: reason },
  'POST /customer-returns/:id/cancel': { summary: 'Cancel', body: reason },
  'POST /customer-returns/:id/receive': {
    summary: 'Receive into quarantine',
    body: s.receiveCustomerReturnSchema,
  },
  'POST /customer-returns/:id/inspect': {
    summary: 'Inspect: restock or write off',
    body: s.inspectCustomerReturnSchema,
  },

  'GET /supplier-returns': {
    summary: 'List supplier returns',
    query: s.listSupplierReturnsQuerySchema,
  },
  'GET /supplier-returns/:id': { summary: 'Get a supplier return' },
  'POST /supplier-returns': {
    summary: 'Create a return to a supplier',
    body: s.supplierReturnSchema,
  },
  'POST /supplier-returns/:id/approve': { summary: 'Approve' },
  'POST /supplier-returns/:id/reject': { summary: 'Reject', body: reason },
  'POST /supplier-returns/:id/cancel': { summary: 'Cancel', body: reason },
  'POST /supplier-returns/:id/dispatch': {
    summary: 'Dispatch; stock leaves usable or quarantine',
    body: s.dispatchSupplierReturnSchema,
  },

  'GET /warehouse-ops/summary': { summary: 'Open transfers, counts, quarantine and returns' },

  'GET /reports/overview': { summary: 'Dashboard figures' },
  'GET /reports/inventory/movement-trend': {
    summary: 'Units in and out per period',
    query: s.trendQuerySchema,
  },
  'GET /reports/inventory/velocity': {
    summary: 'Fast and slow movers by days of cover',
    query: s.velocityQuerySchema,
  },
  'GET /reports/inventory/warehouses': {
    summary: 'Stock and value per warehouse',
    query: s.reportRangeSchema,
  },
  'GET /reports/inventory/availability': {
    summary: 'Availability with incoming and in-transit units',
    query: s.availabilityReportQuerySchema,
  },
  'GET /reports/inventory/categories': {
    summary: 'Totals per category',
    query: s.trendQuerySchema,
  },
  'GET /reports/purchasing/trend': {
    summary: 'Purchase orders per period',
    query: s.trendQuerySchema,
  },
  'GET /reports/purchasing/suppliers': {
    summary: 'Supplier performance',
    query: s.reportTableQuerySchema,
  },
  'GET /reports/purchasing/deliveries': {
    summary: 'Delivery history with days late',
    query: s.reportTableQuerySchema,
  },
  'GET /reports/purchasing/pending': {
    summary: 'Quantities still due from suppliers',
    query: s.reportTableQuerySchema,
  },
  'GET /reports/sales/trend': { summary: 'Sales orders per period', query: s.trendQuerySchema },
  'GET /reports/sales/top-products': {
    summary: 'Top products by units, revenue and cost',
    query: s.reportTableQuerySchema,
  },
  'GET /reports/sales/fulfilment': {
    summary: 'Fulfilment statistics',
    query: s.reportTableQuerySchema,
  },
  'GET /reports/sales/orders': {
    summary: 'Pending and completed orders',
    query: s.salesOrdersReportQuerySchema,
  },

  'GET /notifications': { summary: 'Your notifications', query: s.listNotificationsQuerySchema },
  'GET /notifications/summary': { summary: 'Unread count and approvals waiting for you' },
  'POST /notifications/read-all': { summary: 'Mark everything read' },
  'POST /notifications/:id/read': { summary: 'Mark one read' },

  'GET /audit-logs': { summary: 'Search the audit log', query: s.listAuditLogsQuerySchema },
};
