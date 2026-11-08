import { useState } from 'react';
import { Link } from 'react-router';
import {
  FAST_MOVING_DAYS,
  MOVEMENT_CLASSES,
  MOVEMENT_CLASS_LABELS,
  SLOW_MOVING_DAYS,
  type AvailabilityRowDto,
  type CategoryReportRowDto,
  type MovementClass,
  type VelocityRowDto,
  type WarehouseStockDto,
} from '@stockflow/shared';
import { BarList, formatCount } from '@/components/charts';
import { FilterSelect } from '@/components/filters';
import { StatusBadge } from '@/components/StatusBadge';
import { Skeleton } from '@/components/ui/skeleton';
import { usePageTitle } from '@/lib/use-page-title';
import { useMoney } from '@/features/settings/api';
import { useReport, useReportPage, useTrend } from './api';
import {
  ExportButton,
  ReportFilters,
  ReportTable,
  Section,
  TrendCharts,
  useReportFilters,
  useTableState,
  type Column,
} from './parts';

const MOVEMENT_TONES: Record<MovementClass, 'green' | 'blue' | 'amber' | 'gray'> = {
  fast: 'green',
  normal: 'blue',
  slow: 'amber',
  none: 'gray',
};

const productCell = (row: { product: { id: string; sku: string; name: string } }) => (
  <>
    <Link to={`/products/${row.product.id}`} className="font-medium hover:underline">
      {row.product.name}
    </Link>
    <div className="text-muted-foreground font-mono text-xs">{row.product.sku}</div>
  </>
);

export function InventoryReportsPage() {
  usePageTitle('Inventory analytics');
  const money = useMoney();
  const filters = useReportFilters();
  const { params } = filters;
  const trend = useTrend('/inventory/movement-trend', params);
  const warehouses = useReport<WarehouseStockDto[]>('/inventory/warehouses', {});
  const categories = useReport<CategoryReportRowDto[]>('/inventory/categories', params);

  const velocityTable = useTableState();
  const [movement, setMovement] = useState('');
  const velocityParams = {
    ...params,
    search: velocityTable.search,
    movement,
    page: velocityTable.page,
    pageSize: velocityTable.pageSize,
  };
  const velocity = useReportPage<VelocityRowDto>('/inventory/velocity', velocityParams);

  const availabilityTable = useTableState();
  const [status, setStatus] = useState('');
  const availabilityParams = {
    warehouseId: params.warehouseId,
    categoryId: params.categoryId,
    search: availabilityTable.search,
    status,
    page: availabilityTable.page,
    pageSize: availabilityTable.pageSize,
  };
  const availability = useReportPage<AvailabilityRowDto>(
    '/inventory/availability',
    availabilityParams,
  );

  const velocityColumns: Column<VelocityRowDto>[] = [
    { header: 'Product', cell: productCell },
    {
      header: 'Movement',
      cell: (r) => (
        <StatusBadge tone={MOVEMENT_TONES[r.movement]}>
          {MOVEMENT_CLASS_LABELS[r.movement]}
        </StatusBadge>
      ),
    },
    { header: 'Shipped', align: 'right', cell: (r) => formatCount(r.unitsOut) },
    {
      header: 'Per day',
      align: 'right',
      cell: (r) => r.dailyRate.toLocaleString(),
      className: 'hidden md:table-cell',
    },
    {
      header: 'Received',
      align: 'right',
      cell: (r) => formatCount(r.unitsIn),
      className: 'hidden lg:table-cell',
    },
    { header: 'On hand', align: 'right', cell: (r) => formatCount(r.onHand) },
    {
      header: 'Days of cover',
      align: 'right',
      cell: (r) => (r.daysOfCover === null ? '—' : r.daysOfCover.toLocaleString()),
    },
  ];

  const availabilityColumns: Column<AvailabilityRowDto>[] = [
    { header: 'Product', cell: productCell },
    { header: 'On hand', align: 'right', cell: (r) => formatCount(r.onHand) },
    {
      header: 'Reserved',
      align: 'right',
      cell: (r) => formatCount(r.reserved),
      className: 'hidden md:table-cell',
    },
    {
      header: 'Available',
      align: 'right',
      cell: (r) => <span className="font-medium">{formatCount(r.available)}</span>,
    },
    {
      header: 'Quarantine',
      align: 'right',
      cell: (r) => formatCount(r.quarantine),
      className: 'hidden lg:table-cell',
    },
    {
      header: 'Incoming',
      align: 'right',
      cell: (r) => formatCount(r.incoming),
      className: 'hidden md:table-cell',
    },
    {
      header: 'In transit',
      align: 'right',
      cell: (r) => formatCount(r.inTransit),
      className: 'hidden lg:table-cell',
    },
    {
      header: 'Status',
      cell: (r) =>
        r.status === 'out' ? (
          <StatusBadge tone="red">Out of stock</StatusBadge>
        ) : r.status === 'low' ? (
          <StatusBadge tone="amber">Low</StatusBadge>
        ) : (
          <StatusBadge tone="green">Available</StatusBadge>
        ),
    },
  ];

  const categoryColumns: Column<CategoryReportRowDto>[] = [
    {
      header: 'Category',
      cell: (r) => <span className="font-medium">{r.category?.name ?? '—'}</span>,
    },
    { header: 'Products', align: 'right', cell: (r) => formatCount(r.products) },
    { header: 'On hand', align: 'right', cell: (r) => formatCount(r.onHand) },
    {
      header: 'Value',
      align: 'right',
      cell: (r) => money(r.value),
      className: 'hidden md:table-cell',
    },
    {
      header: 'Received',
      align: 'right',
      cell: (r) => formatCount(r.unitsIn),
      className: 'hidden lg:table-cell',
    },
    { header: 'Shipped', align: 'right', cell: (r) => formatCount(r.unitsOut) },
  ];

  return (
    <>
      <ReportFilters filters={filters} show={['warehouseId', 'categoryId']} />
      <div className="grid gap-6">
        <Section
          title="Stock movement"
          description="Usable units into and out of stock. Without a warehouse filter, transfers count at both ends."
          actions={<ExportButton path="/inventory/movement-trend" params={params} />}
        >
          <TrendCharts
            trend={trend.data}
            isPending={trend.isPending}
            charts={[{ keys: ['in', 'out'], title: 'Units in and out' }]}
          />
        </Section>

        <div className="grid gap-6 xl:grid-cols-2">
          <Section
            title="Stock by warehouse"
            description="Usable units on hand today."
            actions={<ExportButton path="/inventory/warehouses" params={{}} />}
          >
            {warehouses.data ? (
              <BarList
                label="Units on hand by warehouse"
                rows={warehouses.data.map((w) => ({
                  key: w.warehouse.id,
                  label: (
                    <>
                      <span className="font-mono text-xs">{w.warehouse.code}</span>{' '}
                      {w.warehouse.name}
                      {!w.warehouse.isActive ? (
                        <span className="text-muted-foreground"> (inactive)</span>
                      ) : null}
                    </>
                  ),
                  value: w.onHand,
                  detail: `${w.skus} products · ${formatCount(w.available)} available · ${formatCount(w.quarantine)} quarantined${w.value !== null ? ` · ${money(w.value)}` : ''}`,
                }))}
              />
            ) : (
              <Skeleton className="h-40 w-full" />
            )}
          </Section>
          <Section
            title="Categories"
            description="Stock today; units received and shipped in the range."
            actions={<ExportButton path="/inventory/categories" params={params} />}
            flush
          >
            <ReportTable
              columns={categoryColumns}
              rows={categories.data}
              isPending={categories.isPending}
              isError={categories.isError}
              onRetry={() => void categories.refetch()}
              empty="No categories."
              rowKey={(r) => r.category?.id ?? 'none'}
            />
          </Section>
        </div>

        <Section
          title="Fast- and slow-moving products"
          description={`Shipments in the range as a daily rate, and the days the stock on hand would last at that rate. Fast: ${FAST_MOVING_DAYS} days of cover or less. Slow: over ${SLOW_MOVING_DAYS} days, or stock with no shipments.`}
          actions={<ExportButton path="/inventory/velocity" params={velocityParams} />}
          flush
        >
          <ReportTable
            toolbar={
              <>
                {velocityTable.searchInput('Search products', 'Search product or SKU')}
                <FilterSelect
                  label="Filter by movement"
                  value={movement}
                  onChange={(v) => {
                    setMovement(v ?? '');
                    velocityTable.setPage(1);
                  }}
                  allLabel="All movement"
                  options={MOVEMENT_CLASSES.map((m) => ({
                    value: m,
                    label: MOVEMENT_CLASS_LABELS[m],
                  }))}
                />
              </>
            }
            columns={velocityColumns}
            rows={velocity.data?.data}
            meta={velocity.data?.meta}
            isPending={velocity.isPending}
            isError={velocity.isError}
            onRetry={() => void velocity.refetch()}
            onPage={velocityTable.setPage}
            empty="No products match."
            rowKey={(r) => r.product.id}
          />
        </Section>

        <Section
          title="Inventory availability"
          description="Today, per product: usable stock, what's reserved, quarantined, still due on purchase orders and in transit. Status compares available stock with the product's reorder point; pick a warehouse to see that warehouse's status."
          actions={<ExportButton path="/inventory/availability" params={availabilityParams} />}
          flush
        >
          <ReportTable
            toolbar={
              <>
                {availabilityTable.searchInput('Search availability', 'Search product or SKU')}
                <FilterSelect
                  label="Filter by availability"
                  value={status}
                  onChange={(v) => {
                    setStatus(v ?? '');
                    availabilityTable.setPage(1);
                  }}
                  allLabel="Any availability"
                  options={[
                    { value: 'out', label: 'Out of stock' },
                    { value: 'low', label: 'Low' },
                    { value: 'available', label: 'Available' },
                  ]}
                />
              </>
            }
            columns={availabilityColumns}
            rows={availability.data?.data}
            meta={availability.data?.meta}
            isPending={availability.isPending}
            isError={availability.isError}
            onRetry={() => void availability.refetch()}
            onPage={availabilityTable.setPage}
            empty="No products match."
            rowKey={(r) => r.product.id}
          />
        </Section>
      </div>
    </>
  );
}
