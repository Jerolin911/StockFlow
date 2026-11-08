import { Link } from 'react-router';
import { ArrowRight, Check } from 'lucide-react';
import {
  PERMISSION_LABELS,
  ROLE_LABELS,
  ROLES,
  type Permission,
  type Role,
} from '@stockflow/shared';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StockBadge } from '@/components/StatusBadge';
import { useCurrentUser } from '@/features/auth/auth-context';
import { usePurchaseOrders, usePurchaseRequests } from '@/features/purchasing/api';
import { useStockLevels } from '@/features/stock/api';
import { useUserStats } from '@/features/users/api';
import { cn } from '@/lib/utils';

function LowStockCard({ className }: { className: string }) {
  const low = useStockLevels({ status: 'low', sort: 'available', pageSize: 6 });
  const rows = low.data?.data ?? [];
  const total = low.data?.meta.total ?? 0;

  return (
    <Card className={cn('gap-4', className)}>
      <CardHeader>
        <CardTitle>Low stock</CardTitle>
        <CardDescription>
          {low.data
            ? total === 0
              ? 'Every stocked product is above its threshold.'
              : `${total} product–warehouse ${total === 1 ? 'combination is' : 'combinations are'} at or below the threshold.`
            : 'Products at or below their threshold'}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {low.isPending ? (
          <div className="grid gap-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : low.isError ? (
          <p className="text-destructive text-sm">Couldn't load low-stock items.</p>
        ) : rows.length > 0 ? (
          <ul className="divide-y rounded-md border">
            {rows.map((level) => (
              <li
                key={level.id}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <Link
                    to={`/products/${level.product.id}`}
                    className="block truncate font-medium hover:underline"
                  >
                    {level.product.name}
                  </Link>
                  <span className="text-muted-foreground font-mono text-xs">
                    {level.product.sku} · {level.warehouse.code}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="tabular-nums">
                    <span className="font-medium">{level.available}</span>
                    <span className="text-muted-foreground"> / {level.reorderPoint}</span>
                  </span>
                  <StockBadge available={level.available} isLow={level.isLow} />
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {total > 0 ? (
          <Button asChild variant="outline" size="sm" className="justify-self-start">
            <Link to="/stock?status=low">
              View all low stock
              <ArrowRight />
            </Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

const ACCESS_AREAS: { title: string; permissions: Permission[] }[] = [
  {
    title: 'Inventory',
    permissions: [
      'products:write',
      'categories:manage',
      'warehouses:manage',
      'stock:adjust',
      'stock:transfer',
    ],
  },
  { title: 'Warehouse operations', permissions: ['goodsReceipts:create', 'shipments:create'] },
  {
    title: 'Procurement',
    permissions: [
      'purchaseRequests:create',
      'purchaseRequests:approve',
      'suppliers:write',
      'purchaseOrders:write',
      'purchaseOrders:approve',
    ],
  },
  { title: 'Sales', permissions: ['customers:write', 'salesOrders:write'] },
  {
    title: 'Reports',
    permissions: ['reports:inventory', 'reports:purchasing', 'reports:fulfilment'],
  },
  { title: 'Administration', permissions: ['users:manage', 'settings:manage', 'audit:read'] },
];

export function DashboardPage() {
  const { user, permissions } = useCurrentUser();
  const isAdmin = permissions.includes('users:manage');

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Signed in as ${user.name} · ${ROLE_LABELS[user.role]}`}
      />
      <PurchasingTiles />
      <div className="grid gap-6 lg:grid-cols-3">
        <LowStockCard className="lg:col-span-2" />
        {isAdmin ? (
          <UsersCard />
        ) : (
          <AccessCard role={user.role} permissions={permissions} className="" />
        )}
        {isAdmin ? (
          <AccessCard role={user.role} permissions={permissions} className="lg:col-span-3" />
        ) : null}
      </div>
    </>
  );
}

function AccessCard({
  role,
  permissions,
  className,
}: {
  role: Role;
  permissions: Permission[];
  className: string;
}) {
  const areas = ACCESS_AREAS.map((area) => ({
    ...area,
    granted: area.permissions.filter((p) => permissions.includes(p)),
  })).filter((area) => area.granted.length > 0);

  return (
    <Card className={cn('@container', className)}>
      <CardHeader>
        <CardTitle>Your access</CardTitle>
        <CardDescription>What the {ROLE_LABELS[role]} role can do</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-8 gap-y-5 @lg:grid-cols-2 @3xl:grid-cols-3">
          {areas.map((area) => (
            <div key={area.title}>
              <dt className="text-sm font-medium">{area.title}</dt>
              <dd className="mt-2">
                <ul className="grid gap-1.5">
                  {area.granted.map((permission) => (
                    <li
                      key={permission}
                      className="text-muted-foreground flex items-center gap-2 text-sm"
                    >
                      <Check className="text-primary size-3.5 shrink-0" aria-hidden />
                      {PERMISSION_LABELS[permission]}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function UsersCard() {
  const stats = useUserStats();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Users</CardTitle>
        <CardDescription>Active accounts by role</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {stats.isPending ? (
          <div className="grid gap-2">
            {ROLES.map((role) => (
              <Skeleton key={role} className="h-5 w-full" />
            ))}
          </div>
        ) : stats.isError ? (
          <p className="text-destructive text-sm">Couldn't load user counts.</p>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold tabular-nums">{stats.data.active}</span>
              <span className="text-muted-foreground text-sm">
                active{stats.data.inactive > 0 ? ` · ${stats.data.inactive} deactivated` : ''}
              </span>
            </div>
            <dl className="grid gap-2 text-sm">
              {ROLES.map((role) => (
                <div key={role} className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{ROLE_LABELS[role]}</dt>
                  <dd className="font-medium tabular-nums">{stats.data.activeByRole[role]}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
        <Button asChild variant="outline" size="sm" className="justify-self-start">
          <Link to="/users">
            Manage users
            <ArrowRight />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function PurchasingTiles() {
  const requests = usePurchaseRequests({ status: 'submitted', pageSize: 1 });
  const approvals = usePurchaseOrders({ status: 'pending_approval', pageSize: 1 });
  const open = usePurchaseOrders({ open: 'true', pageSize: 1 });
  const overdue = usePurchaseOrders({ overdue: 'true', pageSize: 1 });

  const tiles = [
    {
      label: 'Requests awaiting approval',
      query: requests,
      to: '/purchase-requests?status=submitted',
    },
    {
      label: 'Orders awaiting approval',
      query: approvals,
      to: '/purchase-orders?status=pending_approval',
    },
    { label: 'Open purchase orders', query: open, to: '/purchase-orders?open=true' },
    {
      label: 'Overdue deliveries',
      query: overdue,
      to: '/purchase-orders?overdue=true',
      alert: true,
    },
  ];

  return (
    <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((tile) => {
        const total = tile.query.data?.meta.total;
        return (
          <Link
            key={tile.label}
            to={tile.to}
            className="bg-card hover:border-primary/40 focus-visible:ring-ring/50 rounded-xl border px-4 py-4 shadow-xs outline-none focus-visible:ring-[3px]"
          >
            <p className="text-muted-foreground text-sm">{tile.label}</p>
            {total === undefined ? (
              <Skeleton className="mt-2 h-7 w-12" />
            ) : (
              <p
                className={cn(
                  'mt-1 text-2xl font-semibold tabular-nums',
                  tile.alert && total > 0 && 'text-red-700',
                )}
              >
                {total}
              </p>
            )}
          </Link>
        );
      })}
    </div>
  );
}
