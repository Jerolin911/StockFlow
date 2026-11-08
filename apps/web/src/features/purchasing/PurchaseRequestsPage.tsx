import { Link } from 'react-router';
import { Plus } from 'lucide-react';
import { PURCHASE_REQUEST_STATUSES, PURCHASE_REQUEST_STATUS_LABELS } from '@stockflow/shared';
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
import { formatDate, formatDateTime } from '@/lib/format';
import { compact, useUrlFilters } from '@/lib/use-url-filters';
import { usePurchaseRequests } from './api';
import { PurchaseRequestStatusBadge } from './components';

export function PurchaseRequestsPage() {
  const canCreate = usePermission('purchaseRequests:create');
  const filters = useUrlFilters(['search', 'status', 'warehouseId', 'mine'] as const);
  const warehouses = useWarehouseOptions(true);
  const requests = usePurchaseRequests({
    ...compact(filters.values),
    page: filters.page,
    pageSize: 25,
  });
  const rows = requests.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Purchase requests"
        description="Requests for stock that need approval before they're ordered."
        actions={
          canCreate ? (
            <Button asChild>
              <Link to="/purchase-requests/new">
                <Plus />
                New request
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
            label="Search purchase requests"
          />
          <FilterSelect
            label="Filter by status"
            value={filters.values.status}
            onChange={(status) => filters.update({ status })}
            allLabel="All statuses"
            options={PURCHASE_REQUEST_STATUSES.map((s) => ({
              value: s,
              label: PURCHASE_REQUEST_STATUS_LABELS[s],
            }))}
          />
          <FilterSelect
            label="Filter by warehouse"
            value={filters.values.warehouseId}
            onChange={(warehouseId) => filters.update({ warehouseId })}
            allLabel="All warehouses"
            options={(warehouses.data ?? []).map((w) => ({ value: w.id, label: w.name }))}
          />
          <FilterSelect
            label="Filter by requester"
            value={filters.values.mine}
            onChange={(mine) => filters.update({ mine })}
            allLabel="Everyone's requests"
            options={[{ value: 'true', label: 'My requests' }]}
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
              <TableHead>Warehouse</TableHead>
              <TableHead className="hidden md:table-cell">Products</TableHead>
              <TableHead className="hidden md:table-cell">Needed by</TableHead>
              <TableHead className="hidden pr-4 lg:table-cell">Requested</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableBodyState
              colSpan={6}
              isPending={requests.isPending}
              isError={requests.isError}
              isEmpty={rows.length === 0}
              onRetry={() => void requests.refetch()}
              emptyMessage={
                filters.active ? 'No requests match these filters.' : 'No purchase requests yet.'
              }
            >
              {rows.map((pr) => (
                <TableRow key={pr.id}>
                  <TableCell className="pl-4">
                    <Link
                      to={`/purchase-requests/${pr.id}`}
                      className="font-mono text-xs font-medium hover:underline"
                    >
                      {pr.number}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <PurchaseRequestStatusBadge status={pr.status} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{pr.warehouse.code}</TableCell>
                  <TableCell className="hidden max-w-xs truncate md:table-cell">
                    {pr.lines.map((l) => l.name).join(', ')}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{formatDate(pr.neededBy)}</TableCell>
                  <TableCell className="hidden pr-4 lg:table-cell">
                    <div>{pr.requestedBy.name}</div>
                    <div className="text-muted-foreground text-xs">
                      {formatDateTime(pr.createdAt)}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBodyState>
          </TableBody>
        </Table>
        {requests.data && requests.data.meta.total > 0 ? (
          <Pagination
            meta={requests.data.meta}
            onPageChange={(page) => filters.update({ page: String(page) })}
          />
        ) : null}
      </Card>
    </>
  );
}
