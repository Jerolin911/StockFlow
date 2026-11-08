import { Link } from 'react-router';
import { Plus } from 'lucide-react';
import { SHIPMENT_STATUSES, SHIPMENT_STATUS_LABELS } from '@stockflow/shared';
import { FilterSelect, SearchInput } from '@/components/filters';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
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
import { formatDateTime } from '@/lib/format';
import { compact, useUrlFilters } from '@/lib/use-url-filters';
import { useShipments } from './api';
import { ShipmentStatusBadge } from './components';

const VIEWS = [
  { value: 'pending', label: 'In the warehouse' },
  { value: 'inTransit', label: 'On the way' },
];

export function ShipmentsPage() {
  const canShip = usePermission('shipments:create');
  const filters = useUrlFilters(['search', 'status', 'view', 'warehouseId'] as const);
  const warehouses = useWarehouseOptions(true);
  const { view, ...rest } = filters.values;
  const shipments = useShipments({
    ...compact(rest),
    ...(view ? { [view]: 'true' } : {}),
    page: filters.page,
    pageSize: 25,
  });
  const rows = shipments.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Shipments"
        description="Pick lists through to delivery. Stock leaves the warehouse when a shipment is dispatched."
        actions={
          canShip ? (
            <Button asChild>
              <Link to="/shipments/new">
                <Plus />
                New pick list
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
            placeholder="Search number, order, customer or tracking"
            label="Search shipments"
          />
          <FilterSelect
            label="Filter by status"
            value={filters.values.status}
            onChange={(status) => filters.update({ status, view: '' })}
            allLabel="All statuses"
            options={SHIPMENT_STATUSES.map((s) => ({ value: s, label: SHIPMENT_STATUS_LABELS[s] }))}
          />
          <FilterSelect
            label="Filter by stage"
            value={view}
            onChange={(next) => filters.update({ view: next, status: '' })}
            allLabel="Any stage"
            options={VIEWS}
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
              <TableHead>Order</TableHead>
              <TableHead className="hidden md:table-cell">Customer</TableHead>
              <TableHead className="text-right">Units</TableHead>
              <TableHead className="hidden lg:table-cell">Carrier</TableHead>
              <TableHead className="hidden pr-4 md:table-cell">Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableBodyState
              colSpan={7}
              isPending={shipments.isPending}
              isError={shipments.isError}
              isEmpty={rows.length === 0}
              onRetry={() => void shipments.refetch()}
              emptyMessage={
                filters.active ? 'No shipments match these filters.' : 'No shipments yet.'
              }
            >
              {rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="pl-4">
                    <Link
                      to={`/shipments/${s.id}`}
                      className="font-mono text-xs font-medium hover:underline"
                    >
                      {s.number}
                    </Link>
                    <div className="text-muted-foreground font-mono text-xs">
                      {s.warehouse.code}
                    </div>
                  </TableCell>
                  <TableCell>
                    <ShipmentStatusBadge status={s.status} />
                  </TableCell>
                  <TableCell>
                    <Link
                      to={`/sales-orders/${s.salesOrder.id}`}
                      className="font-mono text-xs hover:underline"
                    >
                      {s.salesOrder.number}
                    </Link>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{s.customer.name}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.totals.picked ?? s.totals.requested}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {s.carrier || '—'}
                    {s.trackingNumber ? (
                      <div className="text-muted-foreground font-mono text-xs">
                        {s.trackingNumber}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden pr-4 md:table-cell">
                    {formatDateTime(s.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBodyState>
          </TableBody>
        </Table>
        {shipments.data && shipments.data.meta.total > 0 ? (
          <Pagination
            meta={shipments.data.meta}
            onPageChange={(page) => filters.update({ page: String(page) })}
          />
        ) : null}
      </Card>
    </>
  );
}
