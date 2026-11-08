import { createBrowserRouter } from 'react-router';
import { NotFoundPage } from '@/components/StatusPages';
import { ChangePasswordPage } from '@/features/auth/ChangePasswordPage';
import { GuestOnly, RequireAuth, RequirePermission } from '@/features/auth/guards';
import { LoginPage } from '@/features/auth/LoginPage';
import { CategoriesPage } from '@/features/catalog/CategoriesPage';
import { ProductDetailPage } from '@/features/catalog/ProductDetailPage';
import { ProductsPage } from '@/features/catalog/ProductsPage';
import { WarehousesPage } from '@/features/catalog/WarehousesPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { PartnersPage } from '@/features/partners/PartnersPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { AdjustmentDetailPage } from '@/features/stock/AdjustmentDetailPage';
import { AdjustmentsPage } from '@/features/stock/AdjustmentsPage';
import { MovementsPage } from '@/features/stock/MovementsPage';
import { NewStockDocumentPage } from '@/features/stock/NewStockDocumentPage';
import { StockLevelsPage } from '@/features/stock/StockLevelsPage';
import { UsersPage } from '@/features/users/UsersPage';
import { AppShell } from './layout/AppShell';

export const router = createBrowserRouter([
  {
    element: <GuestOnly />,
    children: [{ path: '/login', element: <LoginPage /> }],
  },
  {
    element: <RequireAuth />,
    children: [
      { path: '/change-password', element: <ChangePasswordPage /> },
      {
        element: <AppShell />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: '/products', element: <ProductsPage /> },
          { path: '/products/:id', element: <ProductDetailPage /> },
          { path: '/stock', element: <StockLevelsPage /> },
          { path: '/stock/movements', element: <MovementsPage /> },
          { path: '/stock/adjustments', element: <AdjustmentsPage /> },
          {
            element: <RequirePermission permission="stock:adjust" />,
            children: [{ path: '/stock/adjustments/new', element: <NewStockDocumentPage /> }],
          },
          { path: '/stock/adjustments/:id', element: <AdjustmentDetailPage /> },
          { path: '/categories', element: <CategoriesPage /> },
          { path: '/warehouses', element: <WarehousesPage /> },
          { path: '/suppliers', element: <PartnersPage key="suppliers" kind="suppliers" /> },
          { path: '/customers', element: <PartnersPage key="customers" kind="customers" /> },
          {
            element: <RequirePermission permission="users:manage" />,
            children: [{ path: '/users', element: <UsersPage /> }],
          },
          {
            element: <RequirePermission permission="settings:manage" />,
            children: [{ path: '/settings', element: <SettingsPage /> }],
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
