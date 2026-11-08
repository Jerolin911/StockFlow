import { Link } from 'react-router';
import { PackagePlus, Plus } from 'lucide-react';
import {
  ADJUSTMENT_REASON_LABELS,
  STOCK_DOCUMENT_TYPES,
  STOCK_DOCUMENT_TYPE_LABELS,
} from '@stockflow/shared';
import { FilterSelect } from '@/components/filters';
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
import { useAdjustments } from './api';
import { StockDocumentBadge } from './StockDocumentBadge';

export function AdjustmentsPage() {
  const canAdjust = usePermission('stock:adjust');
  const filters = useUrlFilters(['type', 'warehouseId'] as const);
  const warehouses = useWarehouseOptions(true);
  const docs = useAdjustments({ ...compact(filters.values), page: filters.page, pageSize: 25 });
  const rows = docs.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Stock adjustments"
        description="Opening stock registrations and corrections."
        actions={
          canAdjust ? (
            <>
              <Button variant="outline" asChild>
                <Link to="/stock/adjustments/new?type=opening">
                  <PackagePlus />
                  Opening stock
                </Link>
              </Button>
              <Button asChild>
                <Link to="/stock/adjustments/new?type=adjustment">
                  <Plus />
                  New adjustment
                </Link>
              </Button>
            </>
          ) : null
        }
      />
      <Card className="gap-0 overflow-hidden py-0">
        <FilterBar>
          <FilterSelect
            label="Filter by type"
            value={filters.values.type}
            onChange={(type) => filters.update({ type })}
            allLabel="All types"
            options={[
              ...STOCK_DOCUMENT_TYPES.map((t) => ({
                value: t,
                label: STOCK_DOCUMENT_TYPE_LABELS[t],
              })),
            ]}
          />
          <FilterSelect
            label="Filter by warehouse"
            value={filters.values.warehouseId}
            onChange={(warehouseId) => filters.update({ warehouseId })}
            allLabel="All warehouses"
            options={(warehouses.data ?? []).map((w) => ({ value: w.id, label: w.name }))}
          />
        </FilterBar>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Number</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Warehouse</TableHead>
              <TableHead className="hidden md:table-cell">Reason</TableHead>
              <TableHead className="text-right">Products</TableHead>
              <TableHead className="text-right">In</TableHead>
              <TableHead className="text-right">Out</TableHead>
              <TableHead className="hidden pr-4 lg:table-cell">Posted</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableBodyState
              colSpan={8}
              isPending={docs.isPending}
              isError={docs.isError}
              isEmpty={rows.length === 0}
              onRetry={() => void docs.refetch()}
              emptyMessage={
                filters.active ? 'No documents match these filters.' : 'No adjustments yet.'
              }
            >
              {rows.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="pl-4">
                    <Link
                      to={`/stock/adjustments/${d.id}`}
                      className="font-mono text-xs font-medium hover:underline"
                    >
                      {d.number}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StockDocumentBadge type={d.type} />
                    {d.reversedBy ? (
                      <div className="text-muted-foreground mt-1 text-xs">
                        Reversed by {d.reversedBy.number}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{d.warehouse.code}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    {d.reason ? ADJUSTMENT_REASON_LABELS[d.reason] : '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{d.lines.length}</TableCell>
                  <TableCell className="text-right text-emerald-700 tabular-nums">
                    {d.totalIn > 0 ? `+${d.totalIn.toLocaleString()}` : '—'}
                  </TableCell>
                  <TableCell className="text-right text-red-700 tabular-nums">
                    {d.totalOut > 0 ? `−${d.totalOut.toLocaleString()}` : '—'}
                  </TableCell>
                  <TableCell className="hidden pr-4 lg:table-cell">
                    <div>{formatDateTime(d.createdAt)}</div>
                    <div className="text-muted-foreground text-xs">{d.createdBy.name}</div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBodyState>
          </TableBody>
        </Table>
        {docs.data && docs.data.meta.total > 0 ? (
          <Pagination
            meta={docs.data.meta}
            onPageChange={(page) => filters.update({ page: String(page) })}
          />
        ) : null}
      </Card>
    </>
  );
}
