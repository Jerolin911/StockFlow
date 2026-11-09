import type { ComponentType } from 'react';
import { createBrowserRouter } from 'react-router';
import { FullPageLoader } from '@/components/FullPageLoader';
import { NotFoundPage } from '@/components/StatusPages';
import { ChangePasswordPage } from '@/features/auth/ChangePasswordPage';
import { GuestOnly, RequireAuth, RequirePermission } from '@/features/auth/guards';
import { LoginPage } from '@/features/auth/LoginPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { PartnersPage } from '@/features/partners/PartnersPage';
import { AppShell } from './layout/AppShell';

/** Loads a page module on first visit, so each page is its own chunk. */
const page =
  <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  async () => ({ Component: (await load())[name] });

export const router = createBrowserRouter([
  {
    element: <GuestOnly />,
    children: [{ path: '/login', element: <LoginPage /> }],
  },
  {
    element: <RequireAuth />,
    hydrateFallbackElement: <FullPageLoader />,
    children: [
      { path: '/change-password', element: <ChangePasswordPage /> },
      {
        element: <AppShell />,
        children: [
          { index: true, element: <DashboardPage /> },
          {
            path: '/reports',
            lazy: page(() => import('@/features/reports/ReportsLayout'), 'ReportsLayout'),
            children: [
              {
                element: <RequirePermission permission="reports:inventory" />,
                children: [
                  {
                    path: 'inventory',
                    lazy: page(
                      () => import('@/features/reports/InventoryReportsPage'),
                      'InventoryReportsPage',
                    ),
                  },
                ],
              },
              {
                element: <RequirePermission permission="reports:purchasing" />,
                children: [
                  {
                    path: 'purchasing',
                    lazy: page(
                      () => import('@/features/reports/PurchasingReportsPage'),
                      'PurchasingReportsPage',
                    ),
                  },
                ],
              },
              {
                element: <RequirePermission permission="reports:fulfilment" />,
                children: [
                  {
                    path: 'sales',
                    lazy: page(
                      () => import('@/features/reports/SalesReportsPage'),
                      'SalesReportsPage',
                    ),
                  },
                ],
              },
            ],
          },
          {
            path: '/notifications',
            lazy: page(
              () => import('@/features/notifications/NotificationsPage'),
              'NotificationsPage',
            ),
          },
          {
            path: '/products',
            lazy: page(() => import('@/features/catalog/ProductsPage'), 'ProductsPage'),
          },
          {
            path: '/products/:id',
            lazy: page(() => import('@/features/catalog/ProductDetailPage'), 'ProductDetailPage'),
          },
          {
            path: '/stock',
            lazy: page(() => import('@/features/stock/StockLevelsPage'), 'StockLevelsPage'),
          },
          {
            path: '/stock/movements',
            lazy: page(() => import('@/features/stock/MovementsPage'), 'MovementsPage'),
          },
          {
            path: '/stock/adjustments',
            lazy: page(() => import('@/features/stock/AdjustmentsPage'), 'AdjustmentsPage'),
          },
          {
            element: <RequirePermission permission="stock:adjust" />,
            children: [
              {
                path: '/stock/adjustments/new',
                lazy: page(
                  () => import('@/features/stock/NewStockDocumentPage'),
                  'NewStockDocumentPage',
                ),
              },
            ],
          },
          {
            path: '/stock/adjustments/:id',
            lazy: page(
              () => import('@/features/stock/AdjustmentDetailPage'),
              'AdjustmentDetailPage',
            ),
          },
          {
            path: '/stock/transfers',
            lazy: page(() => import('@/features/warehouse/TransfersPage'), 'TransfersPage'),
          },
          {
            element: <RequirePermission permission="stock:transfer" />,
            children: [
              {
                path: '/stock/transfers/new',
                lazy: page(
                  () => import('@/features/warehouse/TransferFormPage'),
                  'TransferFormPage',
                ),
              },
              {
                path: '/stock/transfers/:id/edit',
                lazy: page(
                  () => import('@/features/warehouse/TransferFormPage'),
                  'TransferFormPage',
                ),
              },
            ],
          },
          {
            path: '/stock/transfers/:id',
            lazy: page(
              () => import('@/features/warehouse/TransferDetailPage'),
              'TransferDetailPage',
            ),
          },
          {
            path: '/stock/counts',
            lazy: page(() => import('@/features/warehouse/StockCountsPage'), 'StockCountsPage'),
          },
          {
            path: '/stock/counts/:id',
            lazy: page(
              () => import('@/features/warehouse/StockCountDetailPage'),
              'StockCountDetailPage',
            ),
          },
          {
            path: '/stock/quarantine',
            lazy: page(() => import('@/features/warehouse/QuarantinePage'), 'QuarantinePage'),
          },
          {
            path: '/categories',
            lazy: page(() => import('@/features/catalog/CategoriesPage'), 'CategoriesPage'),
          },
          {
            path: '/warehouses',
            lazy: page(() => import('@/features/catalog/WarehousesPage'), 'WarehousesPage'),
          },
          { path: '/suppliers', element: <PartnersPage key="suppliers" kind="suppliers" /> },
          {
            path: '/suppliers/:id',
            lazy: page(
              () => import('@/features/purchasing/SupplierDetailPage'),
              'SupplierDetailPage',
            ),
          },
          {
            path: '/purchase-requests',
            lazy: page(
              () => import('@/features/purchasing/PurchaseRequestsPage'),
              'PurchaseRequestsPage',
            ),
          },
          {
            element: <RequirePermission permission="purchaseRequests:create" />,
            children: [
              {
                path: '/purchase-requests/new',
                lazy: page(
                  () => import('@/features/purchasing/PurchaseRequestFormPage'),
                  'PurchaseRequestFormPage',
                ),
              },
              {
                path: '/purchase-requests/:id/edit',
                lazy: page(
                  () => import('@/features/purchasing/PurchaseRequestFormPage'),
                  'PurchaseRequestFormPage',
                ),
              },
            ],
          },
          {
            path: '/purchase-requests/:id',
            lazy: page(
              () => import('@/features/purchasing/PurchaseRequestDetailPage'),
              'PurchaseRequestDetailPage',
            ),
          },
          {
            path: '/purchase-orders',
            lazy: page(
              () => import('@/features/purchasing/PurchaseOrdersPage'),
              'PurchaseOrdersPage',
            ),
          },
          {
            element: <RequirePermission permission="purchaseOrders:write" />,
            children: [
              {
                path: '/purchase-orders/new',
                lazy: page(
                  () => import('@/features/purchasing/PurchaseOrderFormPage'),
                  'PurchaseOrderFormPage',
                ),
              },
              {
                path: '/purchase-orders/:id/edit',
                lazy: page(
                  () => import('@/features/purchasing/PurchaseOrderFormPage'),
                  'PurchaseOrderFormPage',
                ),
              },
            ],
          },
          {
            path: '/purchase-orders/:id',
            lazy: page(
              () => import('@/features/purchasing/PurchaseOrderDetailPage'),
              'PurchaseOrderDetailPage',
            ),
          },
          {
            path: '/goods-receipts',
            lazy: page(
              () => import('@/features/purchasing/GoodsReceiptsPage'),
              'GoodsReceiptsPage',
            ),
          },
          {
            element: <RequirePermission permission="goodsReceipts:create" />,
            children: [
              {
                path: '/goods-receipts/new',
                lazy: page(
                  () => import('@/features/purchasing/GoodsReceiptFormPage'),
                  'GoodsReceiptFormPage',
                ),
              },
            ],
          },
          {
            path: '/goods-receipts/:id',
            lazy: page(
              () => import('@/features/purchasing/GoodsReceiptDetailPage'),
              'GoodsReceiptDetailPage',
            ),
          },
          { path: '/customers', element: <PartnersPage key="customers" kind="customers" /> },
          {
            path: '/sales-orders',
            lazy: page(() => import('@/features/sales/SalesOrdersPage'), 'SalesOrdersPage'),
          },
          {
            element: <RequirePermission permission="salesOrders:write" />,
            children: [
              {
                path: '/sales-orders/new',
                lazy: page(
                  () => import('@/features/sales/SalesOrderFormPage'),
                  'SalesOrderFormPage',
                ),
              },
              {
                path: '/sales-orders/:id/edit',
                lazy: page(
                  () => import('@/features/sales/SalesOrderFormPage'),
                  'SalesOrderFormPage',
                ),
              },
            ],
          },
          {
            path: '/sales-orders/:id',
            lazy: page(
              () => import('@/features/sales/SalesOrderDetailPage'),
              'SalesOrderDetailPage',
            ),
          },
          {
            path: '/shipments',
            lazy: page(() => import('@/features/sales/ShipmentsPage'), 'ShipmentsPage'),
          },
          {
            element: <RequirePermission permission="shipments:create" />,
            children: [
              {
                path: '/shipments/new',
                lazy: page(() => import('@/features/sales/ShipmentFormPage'), 'ShipmentFormPage'),
              },
            ],
          },
          {
            path: '/shipments/:id',
            lazy: page(() => import('@/features/sales/ShipmentDetailPage'), 'ShipmentDetailPage'),
          },
          {
            path: '/customer-returns',
            lazy: page(
              () => import('@/features/returns/CustomerReturnsPage'),
              'CustomerReturnsPage',
            ),
          },
          {
            element: <RequirePermission permission="customerReturns:write" />,
            children: [
              {
                path: '/customer-returns/new',
                lazy: page(
                  () => import('@/features/returns/CustomerReturnFormPage'),
                  'CustomerReturnFormPage',
                ),
              },
            ],
          },
          {
            path: '/customer-returns/:id',
            lazy: page(
              () => import('@/features/returns/CustomerReturnDetailPage'),
              'CustomerReturnDetailPage',
            ),
          },
          {
            path: '/supplier-returns',
            lazy: page(
              () => import('@/features/returns/SupplierReturnsPage'),
              'SupplierReturnsPage',
            ),
          },
          {
            element: <RequirePermission permission="supplierReturns:write" />,
            children: [
              {
                path: '/supplier-returns/new',
                lazy: page(
                  () => import('@/features/returns/SupplierReturnFormPage'),
                  'SupplierReturnFormPage',
                ),
              },
            ],
          },
          {
            path: '/supplier-returns/:id',
            lazy: page(
              () => import('@/features/returns/SupplierReturnDetailPage'),
              'SupplierReturnDetailPage',
            ),
          },
          {
            element: <RequirePermission permission="users:manage" />,
            children: [
              {
                path: '/users',
                lazy: page(() => import('@/features/users/UsersPage'), 'UsersPage'),
              },
            ],
          },
          {
            element: <RequirePermission permission="audit:read" />,
            children: [
              {
                path: '/audit-log',
                lazy: page(() => import('@/features/audit/AuditLogPage'), 'AuditLogPage'),
              },
            ],
          },
          {
            element: <RequirePermission permission="settings:manage" />,
            children: [
              {
                path: '/settings',
                lazy: page(() => import('@/features/settings/SettingsPage'), 'SettingsPage'),
              },
            ],
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
