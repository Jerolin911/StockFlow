import { Link } from 'react-router';
import { FilterSelect, SearchInput } from '@/components/filters';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { StockBadge } from '@/components/StatusBadge';
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
import { useCategoryOptions, useWarehouseOptions } from '@/features/catalog/api';
import { compact, useUrlFilters } from '@/lib/use-url-filters';
import { useStockLevels } from './api';

const FILTERS = ['search', 'warehouseId', 'categoryId', 'status'] as const;

export function StockLevelsPage() {
  const filters = useUrlFilters(FILTERS);
  const warehouses = useWarehouseOptions(true);
  const categories = useCategoryOptions();
  const levels = useStockLevels({ ...compact(filters.values), page: filters.page, pageSize: 25 });
  const rows = levels.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Stock levels"
        description="Quantities for each product in each warehouse."
      />
      <Card className="gap-0 overflow-hidden py-0">
        <FilterBar>
          <SearchInput
            value={filters.values.search}
            onChange={(search) => filters.update({ search })}
            placeholder="Search name or SKU"
            label="Search stock"
          />
          <FilterSelect
            label="Filter by warehouse"
            value={filters.values.warehouseId}
            onChange={(warehouseId) => filters.update({ warehouseId })}
            allLabel="All warehouses"
            options={(warehouses.data ?? []).map((w) => ({ value: w.id, label: w.name }))}
          />
          <FilterSelect
            label="Filter by category"
            value={filters.values.categoryId}
            onChange={(categoryId) => filters.update({ categoryId })}
            allLabel="All categories"
            options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          />
          <FilterSelect
            label="Filter by stock"
            value={filters.values.status}
            onChange={(status) => filters.update({ status })}
            allLabel="Any stock level"
            className="w-40"
            options={[
              { value: 'available', label: 'Available' },
              { value: 'low', label: 'Low stock' },
              { value: 'out', label: 'Out of stock' },
            ]}
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
              <TableHead className="pl-4">Product</TableHead>
              <TableHead>Warehouse</TableHead>
              <TableHead className="text-right">On hand</TableHead>
              <TableHead className="text-right">Reserved</TableHead>
              <TableHead className="text-right">Available</TableHead>
              <TableHead className="hidden text-right lg:table-cell">Quarantine</TableHead>
              <TableHead className="hidden text-right md:table-cell">Threshold</TableHead>
              <TableHead className="pr-4">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableBodyState
              colSpan={8}
              isPending={levels.isPending}
              isError={levels.isError}
              isEmpty={rows.length === 0}
              onRetry={() => void levels.refetch()}
              emptyMessage={
                filters.active ? 'No stock matches these filters.' : 'No stock recorded yet.'
              }
            >
              {rows.map((level) => (
                <TableRow key={level.id}>
                  <TableCell className="pl-4">
                    <Link
                      to={`/products/${level.product.id}`}
                      className="font-medium hover:underline"
                    >
                      {level.product.name}
                    </Link>
                    <div className="text-muted-foreground text-xs">
                      <span className="font-mono">{level.product.sku}</span>
                      {level.product.categoryName ? ` · ${level.product.categoryName}` : ''}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{level.warehouse.code}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {level.onHand.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {level.reserved.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {level.available.toLocaleString()}{' '}
                    <span className="text-muted-foreground text-xs font-normal">
                      {level.product.unit}
                    </span>
                  </TableCell>
                  <TableCell
                    className={`hidden text-right tabular-nums lg:table-cell ${level.quarantine > 0 ? 'text-amber-800' : 'text-muted-foreground'}`}
                  >
                    {level.quarantine > 0 ? level.quarantine.toLocaleString() : '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden text-right tabular-nums md:table-cell">
                    {level.reorderPoint > 0 ? level.reorderPoint : 'Off'}
                  </TableCell>
                  <TableCell className="pr-4">
                    <StockBadge available={level.available} isLow={level.isLow} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBodyState>
          </TableBody>
        </Table>
        {levels.data && levels.data.meta.total > 0 ? (
          <Pagination
            meta={levels.data.meta}
            onPageChange={(page) => filters.update({ page: String(page) })}
          />
        ) : null}
      </Card>
    </>
  );
}
