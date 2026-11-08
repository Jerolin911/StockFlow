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
import { useCurrentUser } from '@/features/auth/auth-context';
import { useUserStats } from '@/features/users/api';

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
    permissions: ['suppliers:write', 'purchaseOrders:write', 'purchaseOrders:approve'],
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
      <div className="grid gap-6 lg:grid-cols-3">
        <AccessCard
          role={user.role}
          permissions={permissions}
          className={isAdmin ? 'lg:col-span-2' : 'lg:col-span-3'}
        />
        {isAdmin ? <UsersCard /> : null}
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
    <Card className={className}>
      <CardHeader>
        <CardTitle>Your access</CardTitle>
        <CardDescription>What the {ROLE_LABELS[role]} role can do</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
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
