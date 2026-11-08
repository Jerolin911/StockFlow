import { useState } from 'react';
import { Link } from 'react-router';
import { Plus } from 'lucide-react';
import { FilterSelect, SearchInput } from '@/components/filters';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { StatusBadge, StockBadge } from '@/components/StatusBadge';
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
import { useMoney } from '@/features/settings/api';
import { compact, useUrlFilters } from '@/lib/use-url-filters';
import { useCategoryOptions, useProducts, useWarehouseOptions } from './api';
import { ProductFormDialog } from './ProductFormDialog';

const FILTERS = ['search', 'categoryId', 'warehouseId', 'stock', 'status', 'sort'] as const;

export function ProductsPage() {
  const canWrite = usePermission('products:write');
  const money = useMoney();
  const filters = useUrlFilters(FILTERS);
  const [creating, setCreating] = useState(false);
  const categories = useCategoryOptions();
  const warehouses = useWarehouseOptions();
  const products = useProducts({ ...compact(filters.values), page: filters.page, pageSize: 25 });
  const rows = products.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Products"
        actions={
          canWrite ? (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              Add product
            </Button>
          ) : null
        }
      />
      <Card className="gap-0 overflow-hidden py-0">
        <FilterBar>
          <SearchInput
            value={filters.values.search}
            onChange={(search) => filters.update({ search })}
            placeholder="Search name, SKU or barcode"
            label="Search products"
          />
          <FilterSelect
            label="Filter by category"
            value={filters.values.categoryId}
            onChange={(categoryId) => filters.update({ categoryId })}
            allLabel="All categories"
            options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          />
          <FilterSelect
            label="Stock in warehouse"
            value={filters.values.warehouseId}
            onChange={(warehouseId) => filters.update({ warehouseId })}
            allLabel="All warehouses"
            options={(warehouses.data ?? []).map((w) => ({ value: w.id, label: w.name }))}
          />
          <FilterSelect
            label="Filter by stock"
            value={filters.values.stock}
            onChange={(stock) => filters.update({ stock })}
            allLabel="Any stock level"
            className="w-40"
            options={[
              { value: 'in', label: 'In stock' },
              { value: 'low', label: 'Low stock' },
              { value: 'out', label: 'Out of stock' },
            ]}
          />
          <FilterSelect
            label="Filter by status"
            value={filters.values.status}
            onChange={(status) => filters.update({ status })}
            allLabel="All statuses"
            className="w-36"
            options={[
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
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
              <TableHead className="hidden lg:table-cell">Category</TableHead>
              <TableHead className="text-right">On hand</TableHead>
              <TableHead className="text-right">Available</TableHead>
              <TableHead className="hidden text-right md:table-cell">Price</TableHead>
              <TableHead className="pr-4">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableBodyState
              colSpan={6}
              isPending={products.isPending}
              isError={products.isError}
              isEmpty={rows.length === 0}
              onRetry={() => void products.refetch()}
              emptyMessage={
                filters.active ? 'No products match these filters.' : 'No products yet.'
              }
            >
              {rows.map((p) => (
                <TableRow key={p.id} className={p.isActive ? undefined : 'text-muted-foreground'}>
                  <TableCell className="pl-4">
                    <Link to={`/products/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                    <div className="text-muted-foreground font-mono text-xs">{p.sku}</div>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">{p.category?.name ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.stock.onHand.toLocaleString()}{' '}
                    <span className="text-muted-foreground text-xs">{p.unit}</span>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {p.stock.available.toLocaleString()}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    {money(p.sellingPrice)}
                  </TableCell>
                  <TableCell className="pr-4">
                    <div className="flex flex-wrap gap-1.5">
                      {p.isActive ? null : <StatusBadge tone="gray">Inactive</StatusBadge>}
                      <StockBadge
                        available={p.stock.available}
                        isLow={p.stock.lowStockWarehouses > 0}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBodyState>
          </TableBody>
        </Table>
        {products.data && products.data.meta.total > 0 ? (
          <Pagination
            meta={products.data.meta}
            onPageChange={(page) => filters.update({ page: String(page) })}
          />
        ) : null}
      </Card>
      <ProductFormDialog open={creating} onOpenChange={setCreating} product={null} />
    </>
  );
}
