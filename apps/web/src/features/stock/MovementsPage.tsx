import { X } from 'lucide-react';
import { MOVEMENT_TYPES, MOVEMENT_TYPE_LABELS } from '@stockflow/shared';
import { FilterSelect } from '@/components/filters';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { FilterBar } from '@/components/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useProduct, useWarehouseOptions } from '@/features/catalog/api';
import { compact, useUrlFilters } from '@/lib/use-url-filters';
import { useMovements } from './api';
import { MovementsTable } from './MovementsTable';

const FILTERS = ['productId', 'warehouseId', 'type', 'direction', 'from', 'to'] as const;

export function MovementsPage() {
  const filters = useUrlFilters(FILTERS);
  const warehouses = useWarehouseOptions(true);
  const product = useProduct(filters.values.productId || undefined);
  const movements = useMovements({ ...compact(filters.values), page: filters.page, pageSize: 30 });

  return (
    <>
      <PageHeader
        title="Stock movements"
        description="Every stock-in and stock-out, newest first."
      />
      <Card className="gap-0 overflow-hidden py-0">
        <FilterBar>
          {filters.values.productId ? (
            <Badge variant="secondary" className="h-9 gap-1.5 px-3 text-sm font-normal">
              {product.data ? `${product.data.sku} — ${product.data.name}` : 'Product'}
              <button
                type="button"
                onClick={() => filters.update({ productId: undefined })}
                aria-label="Remove product filter"
                className="hover:text-foreground text-muted-foreground"
              >
                <X className="size-3.5" />
              </button>
            </Badge>
          ) : null}
          <FilterSelect
            label="Filter by warehouse"
            value={filters.values.warehouseId}
            onChange={(warehouseId) => filters.update({ warehouseId })}
            allLabel="All warehouses"
            options={(warehouses.data ?? []).map((w) => ({ value: w.id, label: w.name }))}
          />
          <FilterSelect
            label="Filter by direction"
            value={filters.values.direction}
            onChange={(direction) => filters.update({ direction })}
            allLabel="In and out"
            className="w-36"
            options={[
              { value: 'in', label: 'Stock in' },
              { value: 'out', label: 'Stock out' },
            ]}
          />
          <FilterSelect
            label="Filter by type"
            value={filters.values.type}
            onChange={(type) => filters.update({ type })}
            allLabel="All types"
            className="w-40"
            options={MOVEMENT_TYPES.map((t) => ({ value: t, label: MOVEMENT_TYPE_LABELS[t] }))}
          />
          <div className="flex items-center gap-2">
            <Label htmlFor="from" className="text-muted-foreground text-sm font-normal">
              From
            </Label>
            <Input
              id="from"
              type="date"
              className="w-38"
              value={filters.values.from}
              max={filters.values.to || undefined}
              onChange={(event) => filters.update({ from: event.target.value || undefined })}
            />
            <Label htmlFor="to" className="text-muted-foreground text-sm font-normal">
              To
            </Label>
            <Input
              id="to"
              type="date"
              className="w-38"
              value={filters.values.to}
              min={filters.values.from || undefined}
              onChange={(event) => filters.update({ to: event.target.value || undefined })}
            />
          </div>
          {filters.active ? (
            <Button variant="ghost" size="sm" onClick={filters.clear}>
              Clear filters
            </Button>
          ) : null}
        </FilterBar>
        <MovementsTable
          rows={movements.data?.data ?? []}
          isPending={movements.isPending}
          isError={movements.isError}
          onRetry={() => void movements.refetch()}
          emptyMessage={
            filters.active ? 'No movements match these filters.' : 'No stock movements yet.'
          }
        />
        {movements.data && movements.data.meta.total > 0 ? (
          <Pagination
            meta={movements.data.meta}
            onPageChange={(page) => filters.update({ page: String(page) })}
          />
        ) : null}
      </Card>
    </>
  );
}
