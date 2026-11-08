import { Link } from 'react-router';
import { ArrowRight, Check } from 'lucide-react';
import {
  PERMISSION_LABELS,
  ROLE_LABELS,
  ROLES,
  type OverviewDto,
  type Permission,
  type Role,
} from '@stockflow/shared';
import { BarList, StatTile, formatCount } from '@/components/charts';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StockBadge } from '@/components/StatusBadge';
import { useCurrentUser } from '@/features/auth/auth-context';
import { useFulfilmentSummary } from '@/features/sales/api';
import { useWarehouseOpsSummary } from '@/features/warehouse/api';
import { useOverview } from '@/features/reports/api';
import { useMoney } from '@/features/settings/api';
import { useStockLevels } from '@/features/stock/api';
import { MovementsTable } from '@/features/stock/MovementsTable';
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
      'stock:count',
    ],
  },
  {
    title: 'Warehouse operations',
    permissions: [
      'stock:transfer',
      'transfers:approve',
      'goodsReceipts:create',
      'shipments:create',
      'returns:process',
    ],
  },
  {
    title: 'Procurement',
    permissions: [
      'purchaseRequests:create',
      'purchaseRequests:approve',
      'suppliers:write',
      'purchaseOrders:write',
      'purchaseOrders:approve',
      'supplierReturns:write',
      'supplierReturns:approve',
    ],
  },
  {
    title: 'Sales',
    permissions: ['customers:write', 'salesOrders:write', 'customerReturns:write'],
  },
  {
    title: 'Reports',
    permissions: ['reports:inventory', 'reports:purchasing', 'reports:fulfilment'],
  },
  { title: 'Administration', permissions: ['users:manage', 'settings:manage', 'audit:read'] },
];

export function DashboardPage() {
  const { user, permissions } = useCurrentUser();
  const isAdmin = permissions.includes('users:manage');
  const overview = useOverview();
  const money = useMoney();
  const o = overview.data;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Signed in as ${user.name} · ${ROLE_LABELS[user.role]}`}
      />
      <section aria-label="Key figures" className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {o ? (
          <>
            <StatTile
              label="Active products"
              value={formatCount(o.products.active)}
              detail={
                o.products.inactive > 0
                  ? `${formatCount(o.products.inactive)} inactive`
                  : 'None inactive'
              }
              to="/products"
            />
            <StatTile
              label="Units on hand"
              value={formatCount(o.stock.onHand)}
              detail={`${formatCount(o.stock.available)} available · ${formatCount(o.stock.quarantine)} quarantined${o.stock.value !== null ? ` · ${money(o.stock.value)}` : ''}`}
              to="/stock"
            />
            <StatTile
              label="Low stock"
              value={formatCount(o.lowStock)}
              detail="Product–warehouse combinations at or below threshold"
              to="/stock?status=low"
              alert={o.lowStock > 0}
            />
            <StatTile
              label="Out of stock"
              value={formatCount(o.outOfStock)}
              detail="Held in a warehouse with nothing available"
              to="/stock?status=out"
              alert={o.outOfStock > 0}
            />
          </>
        ) : (
          Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[104px] w-full rounded-xl" />
          ))
        )}
      </section>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Warehouse distribution</CardTitle>
            <CardDescription>Usable units on hand in each warehouse.</CardDescription>
          </CardHeader>
          <CardContent>
            {o ? (
              <BarList
                label="Units on hand by warehouse"
                rows={o.warehouses.map((w) => ({
                  key: w.warehouse.id,
                  label: (
                    <>
                      <span className="font-mono text-xs">{w.warehouse.code}</span>{' '}
                      {w.warehouse.name}
                      {!w.warehouse.isActive ? (
                        <span className="text-muted-foreground"> (inactive)</span>
                      ) : null}
                    </>
                  ),
                  value: w.onHand,
                  detail: `${w.skus} products · ${formatCount(w.reserved)} reserved · ${w.lowStock} low · ${w.outOfStock} out${w.value !== null ? ` · ${money(w.value)}` : ''}`,
                }))}
              />
            ) : (
              <Skeleton className="h-40 w-full" />
            )}
          </CardContent>
        </Card>
        <PendingWorkCard overview={o} />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card className="gap-0 overflow-hidden pb-0 lg:col-span-2">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Recent inventory movements</CardTitle>
              <Button asChild variant="ghost" size="sm">
                <Link to="/stock/movements">
                  All movements
                  <ArrowRight />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <MovementsTable
            rows={o?.recentMovements ?? []}
            isPending={overview.isPending}
            isError={overview.isError}
            onRetry={() => void overview.refetch()}
            emptyMessage="No stock movements yet."
          />
        </Card>
        <LowStockCard className="" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {isAdmin ? <UsersCard /> : null}
        <AccessCard
          role={user.role}
          permissions={permissions}
          className={isAdmin ? 'lg:col-span-2' : 'lg:col-span-3'}
        />
      </div>
    </>
  );
}

/** Operational queues, each linking to the list that works it. */
function PendingWorkCard({ overview: o }: { overview: OverviewDto | undefined }) {
  const fulfilment = useFulfilmentSummary().data;
  const ops = useWarehouseOpsSummary().data;
  const items: { label: string; value: number | undefined; to: string; alert?: boolean }[] = [
    {
      label: 'Purchase orders awaiting approval',
      value: o?.purchasing.pendingApproval,
      to: '/purchase-orders?status=pending_approval',
    },
    { label: 'Open purchase orders', value: o?.purchasing.open, to: '/purchase-orders?open=true' },
    {
      label: 'Overdue deliveries',
      value: o?.purchasing.overdue,
      to: '/purchase-orders?overdue=true',
      alert: true,
    },
    {
      label: 'Units still due from suppliers',
      value: o?.purchasing.pendingUnits,
      to: '/purchase-orders?open=true',
    },
    {
      label: 'Sales orders to confirm',
      value: o?.sales.toConfirm,
      to: '/sales-orders?status=draft',
    },
    {
      label: 'Orders awaiting fulfilment',
      value: o?.sales.awaitingFulfilment,
      to: '/sales-orders?view=toFulfil',
    },
    {
      label: 'Shipments to pick, pack or dispatch',
      value: fulfilment
        ? fulfilment.shipmentsToPick + fulfilment.shipmentsToPack + fulfilment.shipmentsToDispatch
        : undefined,
      to: '/shipments?view=pending',
    },
    { label: 'Shipments on the way', value: o?.sales.inTransit, to: '/shipments?view=inTransit' },
    {
      label: 'Transfers to approve or dispatch',
      value: ops ? ops.transfersToApprove + ops.transfersToDispatch : undefined,
      to: '/stock/transfers?status=requested',
    },
    {
      label: 'Transfers in transit',
      value: ops?.transfersInTransit,
      to: '/stock/transfers?inTransit=true',
    },
    {
      label: 'Returns to approve, receive or inspect',
      value: ops ? ops.returnsToApprove + ops.returnsToReceive + ops.returnsToInspect : undefined,
      to: '/customer-returns',
    },
  ];
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>Pending work</CardTitle>
        <CardDescription>Open documents across the business.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {items.map((item) => (
            <li key={item.label}>
              <Link
                to={item.to}
                className="hover:bg-muted/50 -mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm"
              >
                <span className="text-muted-foreground">{item.label}</span>
                {item.value === undefined ? (
                  <Skeleton className="h-4 w-6" />
                ) : (
                  <span
                    className={cn(
                      'font-medium tabular-nums',
                      item.alert && item.value > 0 && 'text-red-700',
                    )}
                  >
                    {formatCount(item.value)}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
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
