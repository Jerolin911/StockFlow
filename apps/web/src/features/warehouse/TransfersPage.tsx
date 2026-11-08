import { Link } from 'react-router';
import { Plus } from 'lucide-react';
import { TRANSFER_STATUSES, TRANSFER_STATUS_LABELS } from '@stockflow/shared';
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
import { useTransfers } from './api';
import { TransferStatusBadge } from './components';

export function TransfersPage() {
  const canRequest = usePermission('stock:transfer');
  const filters = useUrlFilters(['search', 'status', 'inTransit', 'warehouseId'] as const);
  const warehouses = useWarehouseOptions(true);
  const transfers = useTransfers({ ...compact(filters.values), page: filters.page, pageSize: 25 });
  const rows = transfers.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Transfers"
        description="Stock moving between warehouses. Dispatched units are in transit until received."
        actions={
          canRequest ? (
            <Button asChild>
              <Link to="/stock/transfers/new">
                <Plus />
                New transfer request
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
            placeholder="Search number, product or SKU"
            label="Search transfers"
          />
          <FilterSelect
            label="Filter by status"
            value={filters.values.status}
            onChange={(status) => filters.update({ status, inTransit: '' })}
            allLabel="All statuses"
            options={TRANSFER_STATUSES.map((s) => ({ value: s, label: TRANSFER_STATUS_LABELS[s] }))}
          />
          <FilterSelect
            label="Filter by transit"
            value={filters.values.inTransit}
            onChange={(inTransit) => filters.update({ inTransit, status: '' })}
            allLabel="Any stage"
            options={[{ value: 'true', label: 'Stock in transit' }]}
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
              <TableHead>Route</TableHead>
              <TableHead className="hidden md:table-cell">Products</TableHead>
              <TableHead className="text-right">In transit</TableHead>
              <TableHead className="hidden pr-4 lg:table-cell">Requested</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableBodyState
              colSpan={6}
              isPending={transfers.isPending}
              isError={transfers.isError}
              isEmpty={rows.length === 0}
              onRetry={() => void transfers.refetch()}
              emptyMessage={
                filters.active ? 'No transfers match these filters.' : 'No transfers yet.'
              }
            >
              {rows.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="pl-4">
                    <Link
                      to={`/stock/transfers/${t.id}`}
                      className="font-mono text-xs font-medium hover:underline"
                    >
                      {t.number}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <TransferStatusBadge status={t.status} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {t.fromWarehouse.code} → {t.toWarehouse.code}
                  </TableCell>
                  <TableCell className="hidden max-w-xs truncate md:table-cell">
                    {t.lines.map((l) => l.name).join(', ')}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {t.totals.inTransit > 0 ? t.totals.inTransit : '—'}
                  </TableCell>
                  <TableCell className="hidden pr-4 lg:table-cell">
                    <div>{t.requestedBy.name}</div>
                    <div className="text-muted-foreground text-xs">
                      {formatDateTime(t.createdAt)}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBodyState>
          </TableBody>
        </Table>
        {transfers.data && transfers.data.meta.total > 0 ? (
          <Pagination
            meta={transfers.data.meta}
            onPageChange={(page) => filters.update({ page: String(page) })}
          />
        ) : null}
      </Card>
    </>
  );
}
