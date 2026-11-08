import { Link } from 'react-router';
import { Plus } from 'lucide-react';
import { SALES_ORDER_STATUSES, SALES_ORDER_STATUS_LABELS } from '@stockflow/shared';
import { FilterSelect, SearchInput } from '@/components/filters';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { StatusBadge } from '@/components/StatusBadge';
import { FilterBar, TableBodyState } from '@/components/table';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usePermission } from '@/features/auth/auth-context';
import { useWarehouseOptions } from '@/features/catalog/api';
import { usePartners } from '@/features/partners/api';
import { useMoney } from '@/features/settings/api';
import { formatDate } from '@/lib/format';
import { compact, useUrlFilters } from '@/lib/use-url-filters';
import { useSalesOrders } from './api';
import { SalesOrderStatusBadge } from './components';

const VIEWS = [
  { value: 'open', label: 'Open (holding stock)' },
  { value: 'toFulfil', label: 'Waiting for a pick list' },
];

export function SalesOrdersPage() {
  const canWrite = usePermission('salesOrders:write');
  const money = useMoney();
  const filters = useUrlFilters(['search', 'status', 'view', 'customerId', 'warehouseId'] as const);
  const warehouses = useWarehouseOptions(true);
  const customers = usePartners('customers', { pageSize: 100, sort: 'name' });
  const { view, ...rest } = filters.values;
  const orders = useSalesOrders({
    ...compact(rest),
    ...(view === 'open' ? { open: 'true' } : {}),
    ...(view === 'toFulfil' ? { toFulfil: 'true' } : {}),
    page: filters.page,
    pageSize: 25,
  });
  const rows = orders.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Sales orders"
        description="Customer orders. Confirmed orders reserve stock until it ships."
        actions={
          canWrite ? (
            <Button asChild>
              <Link to="/sales-orders/new">
                <Plus />
                New order
              </Link>
            </Button>
          ) : null
        }
      />
      <Card className="gap-0 overflow-hidden py-0">
        <FilterBar>
          <SearchInput
            value={filters.values.search}
            onChange={(search) => filters.update({ search })}
            placeholder="Search number, customer or reference"
            label="Search sales orders"
          />
          <FilterSelect
            label="Filter by status"
            value={filters.values.status}
            onChange={(status) => filters.update({ status, view: '' })}
            allLabel="All statuses"
            options={SALES_ORDER_STATUSES.map((s) => ({
              value: s,
              label: SALES_ORDER_STATUS_LABELS[s],
            }))}
          />
          <FilterSelect
            label="Filter by fulfilment"
            value={view}
            onChange={(next) => filters.update({ view: next, status: '' })}
            allLabel="Any fulfilment"
            options={VIEWS}
          />
          <FilterSelect
            label="Filter by customer"
            value={filters.values.customerId}
            onChange={(customerId) => filters.update({ customerId })}
            allLabel="All customers"
            options={(customers.data?.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          />
          <FilterSelect
            label="Filter by warehouse"
            value={filters.values.warehouseId}
            onChange={(warehouseId) => filters.update({ warehouseId })}
            allLabel="All warehouses"
            options={(warehouses.data ?? []).map((w) => ({ value: w.id, label: w.name }))}
          />
          {filters.active ? (
            <Button variant="ghost" size="sm" onClick={filters.clear}>
              Clear filters
            </Button>
          ) : null}
        </FilterBar>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Number</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="hidden md:table-cell">Ship from</TableHead>
              <TableHead className="hidden text-right lg:table-cell">Shipped</TableHead>
              <TableHead className="hidden md:table-cell">Required by</TableHead>
              <TableHead className="pr-4 text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableBodyState
              colSpan={7}
              isPending={orders.isPending}
              isError={orders.isError}
              isEmpty={rows.length === 0}
              onRetry={() => void orders.refetch()}
              emptyMessage={
                filters.active ? 'No orders match these filters.' : 'No sales orders yet.'
              }
            >
              {rows.map((so) => {
                const ordered = so.lines.reduce((s, l) => s + l.quantity - l.cancelledQuantity, 0);
                const shipped = so.lines.reduce((s, l) => s + l.shippedQuantity, 0);
                return (
                  <TableRow key={so.id}>
                    <TableCell className="pl-4">
                      <Link
                        to={`/sales-orders/${so.id}`}
                        className="font-mono text-xs font-medium hover:underline"
                      >
                        {so.number}
                      </Link>
                      <div className="text-muted-foreground text-xs">
                        {formatDate(so.orderDate)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-wrap gap-1">
                        <SalesOrderStatusBadge status={so.status} />
                        {so.isOverdue ? <StatusBadge tone="red">Overdue</StatusBadge> : null}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div>{so.customer.name}</div>
                      {so.customerReference ? (
                        <div className="text-muted-foreground text-xs">
                          Ref {so.customerReference}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs md:table-cell">
                      {so.warehouse.code}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">
                      {so.status === 'draft' || ordered === 0 ? '—' : `${shipped} / ${ordered}`}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {formatDate(so.requiredDate)}
                    </TableCell>
                    <TableCell className="pr-4 text-right tabular-nums">
                      {money(so.total)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBodyState>
          </TableBody>
        </Table>
        {orders.data && orders.data.meta.total > 0 ? (
          <Pagination
            meta={orders.data.meta}
            onPageChange={(page) => filters.update({ page: String(page) })}
          />
        ) : null}
      </Card>
    </>
  );
}
