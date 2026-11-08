import { Link } from 'react-router';
import { PackageCheck } from 'lucide-react';
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
import { formatDateTime } from '@/lib/format';
import { compact, useUrlFilters } from '@/lib/use-url-filters';
import { useGoodsReceipts } from './api';

export function GoodsReceiptsPage() {
  const canReceive = usePermission('goodsReceipts:create');
  const filters = useUrlFilters(['search', 'supplierId', 'warehouseId', 'issues'] as const);
  const warehouses = useWarehouseOptions(true);
  const suppliers = usePartners('suppliers', { pageSize: 100 });
  const receipts = useGoodsReceipts({
    ...compact(filters.values),
    page: filters.page,
    pageSize: 25,
  });
  const rows = receipts.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Goods receipts"
        description="Deliveries received against purchase orders."
        actions={
          canReceive ? (
            <Button asChild>
              <Link to="/goods-receipts/new">
                <PackageCheck />
                Receive goods
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
            placeholder="Search number, order, supplier or delivery note"
            label="Search goods receipts"
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
          <FilterSelect
            label="Filter by quality"
            value={filters.values.issues}
            onChange={(issues) => filters.update({ issues })}
            allLabel="All deliveries"
            options={[{ value: 'true', label: 'With rejected or damaged' }]}
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
              <TableHead>Purchase order</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead className="hidden md:table-cell">Warehouse</TableHead>
              <TableHead className="text-right">Accepted</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Rejected / damaged</TableHead>
              <TableHead className="hidden pr-4 lg:table-cell">Received</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableBodyState
              colSpan={7}
              isPending={receipts.isPending}
              isError={receipts.isError}
              isEmpty={rows.length === 0}
              onRetry={() => void receipts.refetch()}
              emptyMessage={
                filters.active ? 'No receipts match these filters.' : 'No goods received yet.'
              }
            >
              {rows.map((grn) => (
                <TableRow key={grn.id}>
                  <TableCell className="pl-4">
                    <Link
                      to={`/goods-receipts/${grn.id}`}
                      className="font-mono text-xs font-medium hover:underline"
                    >
                      {grn.number}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link
                      to={`/purchase-orders/${grn.purchaseOrder.id}`}
                      className="font-mono text-xs hover:underline"
                    >
                      {grn.purchaseOrder.number}
                    </Link>
                  </TableCell>
                  <TableCell>{grn.supplier.name}</TableCell>
                  <TableCell className="hidden font-mono text-xs md:table-cell">
                    {grn.warehouse.code}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{grn.totals.accepted}</TableCell>
                  <TableCell className="hidden text-right sm:table-cell">
                    {grn.totals.rejected + grn.totals.damaged > 0 ? (
                      <StatusBadge tone="red">
                        {grn.totals.rejected} / {grn.totals.damaged}
                      </StatusBadge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden pr-4 lg:table-cell">
                    <div>{formatDateTime(grn.receivedAt)}</div>
                    <div className="text-muted-foreground text-xs">{grn.createdBy.name}</div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBodyState>
          </TableBody>
        </Table>
        {receipts.data && receipts.data.meta.total > 0 ? (
          <Pagination
            meta={receipts.data.meta}
            onPageChange={(page) => filters.update({ page: String(page) })}
          />
        ) : null}
      </Card>
    </>
  );
}
