import { Link } from 'react-router';
import { Plus } from 'lucide-react';
import { PURCHASE_ORDER_STATUSES, PURCHASE_ORDER_STATUS_LABELS } from '@stockflow/shared';
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
import { usePurchaseOrders } from './api';
import { PurchaseOrderStatusBadge } from './components';

const FILTERS = ['search', 'status', 'open', 'overdue', 'supplierId', 'warehouseId'] as const;

export function PurchaseOrdersPage() {
  const canWrite = usePermission('purchaseOrders:write');
  const money = useMoney();
  const filters = useUrlFilters(FILTERS);
  const warehouses = useWarehouseOptions(true);
  const suppliers = usePartners('suppliers', { pageSize: 100 });
  const orders = usePurchaseOrders({
    ...compact(filters.values),
    page: filters.page,
    pageSize: 25,
  });
  const rows = orders.data?.data ?? [];

  // "Open" and "overdue" are status views of their own, so they share the status filter.
  const statusValue = filters.values.overdue
    ? 'overdue'
    : filters.values.open
      ? 'open'
      : filters.values.status;

  return (
    <>
      <PageHeader
        title="Purchase orders"
        actions={
          canWrite ? (
            <Button asChild>
              <Link to="/purchase-orders/new">
                <Plus />
                New purchase order
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
            placeholder="Search number or supplier"
            label="Search purchase orders"
          />
          <FilterSelect
            label="Filter by status"
            value={statusValue}
            onChange={(value) =>
              filters.update({
                status: value && value !== 'open' && value !== 'overdue' ? value : undefined,
                open: value === 'open' ? 'true' : undefined,
                overdue: value === 'overdue' ? 'true' : undefined,
              })
            }
            allLabel="All statuses"
            className="w-48"
            options={[
              { value: 'open', label: 'Open (awaiting goods)' },
              { value: 'overdue', label: 'Overdue' },
              ...PURCHASE_ORDER_STATUSES.map((s) => ({
                value: s,
                label: PURCHASE_ORDER_STATUS_LABELS[s],
              })),
            ]}
          />
          <FilterSelect
            label="Filter by supplier"
            value={filters.values.supplierId}
            onChange={(supplierId) => filters.update({ supplierId })}
            allLabel="All suppliers"
            options={(suppliers.data?.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
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
              <TableHead>Supplier</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Warehouse</TableHead>
              <TableHead className="hidden lg:table-cell">Ordered</TableHead>
              <TableHead className="hidden md:table-cell">Expected</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Received</TableHead>
              <TableHead className="pr-4 text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableBodyState
              colSpan={8}
              isPending={orders.isPending}
              isError={orders.isError}
              isEmpty={rows.length === 0}
              onRetry={() => void orders.refetch()}
              emptyMessage={
                filters.active
                  ? 'No purchase orders match these filters.'
                  : 'No purchase orders yet.'
              }
            >
              {rows.map((po) => {
                const ordered = po.lines.reduce((s, l) => s + l.quantity, 0);
                const received = po.lines.reduce((s, l) => s + l.receivedQuantity, 0);
                return (
                  <TableRow key={po.id}>
                    <TableCell className="pl-4">
                      <Link
                        to={`/purchase-orders/${po.id}`}
                        className="font-mono text-xs font-medium hover:underline"
                      >
                        {po.number}
                      </Link>
                    </TableCell>
                    <TableCell>{po.supplier.name}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        <PurchaseOrderStatusBadge status={po.status} />
                        {po.isOverdue ? <StatusBadge tone="red">Overdue</StatusBadge> : null}
                      </div>
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs md:table-cell">
                      {po.warehouse.code}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {formatDate(po.orderDate)}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {formatDate(po.expectedDate)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">
                      {received} / {ordered}
                    </TableCell>
                    <TableCell className="pr-4 text-right tabular-nums">
                      {money(po.total)}
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
