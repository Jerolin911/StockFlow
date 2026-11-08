import { Navigate, NavLink, Outlet, useLocation, useSearchParams } from 'react-router';
import type { Permission } from '@stockflow/shared';
import { PageHeader } from '@/components/PageHeader';
import { ForbiddenPage } from '@/components/StatusPages';
import { useCurrentUser } from '@/features/auth/auth-context';
import { cn } from '@/lib/utils';

export const REPORT_TABS: { to: string; label: string; permission: Permission }[] = [
  { to: '/reports/inventory', label: 'Inventory', permission: 'reports:inventory' },
  { to: '/reports/purchasing', label: 'Procurement', permission: 'reports:purchasing' },
  { to: '/reports/sales', label: 'Sales', permission: 'reports:fulfilment' },
];

export function ReportsLayout() {
  const { permissions } = useCurrentUser();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const tabs = REPORT_TABS.filter((t) => permissions.includes(t.permission));
  const current = REPORT_TABS.find((t) => pathname.startsWith(t.to));
  if (tabs.length === 0 || (current && !permissions.includes(current.permission))) {
    return <ForbiddenPage />;
  }
  if (pathname === '/reports') return <Navigate to={tabs[0]!.to} replace />;
  // Keep the date range and warehouse when switching tabs.
  const carry = new URLSearchParams();
  for (const key of ['from', 'to', 'warehouseId']) {
    const value = params.get(key);
    if (value) carry.set(key, value);
  }
  const suffix = carry.size > 0 ? `?${carry.toString()}` : '';

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Computed from the live records: stock levels, the movement ledger, orders, receipts and shipments."
      />
      {tabs.length > 1 ? (
        <nav className="mb-4 flex gap-1 border-b" aria-label="Report sections">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={`${t.to}${suffix}`}
              className={({ isActive }) =>
                cn(
                  '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
                  isActive
                    ? 'border-primary text-foreground'
                    : 'text-muted-foreground hover:text-foreground border-transparent',
                )
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      ) : null}
      <Outlet />
    </>
  );
}
