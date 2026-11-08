import { useState } from 'react';
import { Link } from 'react-router';
import {
  SALES_ORDER_STATUS_LABELS,
  SHIPMENT_STATUS_LABELS,
  type FulfilmentStatsDto,
  type SalesOrderReportRowDto,
  type TopProductRowDto,
} from '@stockflow/shared';
import { StatTile, formatCount } from '@/components/charts';
import { FilterSelect } from '@/components/filters';
import { StatusBadge } from '@/components/StatusBadge';
import { Skeleton } from '@/components/ui/skeleton';
import { SalesOrderStatusBadge } from '@/features/sales/components';
import { useMoney } from '@/features/settings/api';
import { formatDate } from '@/lib/format';
import { usePageTitle } from '@/lib/use-page-title';
import { useReport, useReportPage, useTrend } from './api';
import {
  ExportButton,
  ReportFilters,
  ReportTable,
  Section,
  TrendCharts,
  percent,
  useReportFilters,
  useTableState,
  type Column,
} from './parts';

export function SalesReportsPage() {
  usePageTitle('Sales analytics');
  const money = useMoney();
  const filters = useReportFilters();
  const { params } = filters;
  const trend = useTrend('/sales/trend', params);
  const stats = useReport<FulfilmentStatsDto>('/sales/fulfilment', params);

  const topTable = useTableState();
  const topParams = {
    ...params,
    search: topTable.search,
    page: topTable.page,
    pageSize: topTable.pageSize,
  };
  const top = useReportPage<TopProductRowDto>('/sales/top-products', topParams);

  const orderTable = useTableState();
  const [state, setState] = useState('pending');
  const orderParams = {
    ...params,
    state,
    search: orderTable.search,
    page: orderTable.page,
    pageSize: orderTable.pageSize,
  };
  const orders = useReportPage<SalesOrderReportRowDto>('/sales/orders', orderParams);

  const topColumns: Column<TopProductRowDto>[] = [
    {
      header: 'Product',
      cell: (r) => (
        <>
          <Link to={`/products/${r.product.id}`} className="font-medium hover:underline">
            {r.product.name}
          </Link>
          <div className="text-muted-foreground font-mono text-xs">{r.product.sku}</div>
        </>
      ),
    },
    {
      header: 'Category',
      cell: (r) => r.product.category?.name ?? '—',
      className: 'hidden lg:table-cell',
    },
    {
      header: 'Units shipped',
      align: 'right',
      cell: (r) => <span className="font-medium">{formatCount(r.unitsShipped)}</span>,
    },
    {
      header: 'Orders',
      align: 'right',
      cell: (r) => formatCount(r.orders),
      className: 'hidden md:table-cell',
    },
    { header: 'Revenue (net)', align: 'right', cell: (r) => money(r.revenue) },
    {
      header: 'Cost',
      align: 'right',
      cell: (r) => money(r.cost),
      className: 'hidden md:table-cell',
    },
  ];

  const orderColumns: Column<SalesOrderReportRowDto>[] = [
    {
      header: 'Order',
      cell: (r) => (
        <>
          <Link
            to={`/sales-orders/${r.salesOrder.id}`}
            className="font-mono text-xs font-medium hover:underline"
          >
            {r.salesOrder.number}
          </Link>
          <div className="text-muted-foreground text-xs">{formatDate(r.orderDate)}</div>
        </>
      ),
    },
    { header: 'Customer', cell: (r) => r.customer.name },
    {
      header: 'Status',
      cell: (r) => (
        <span className="flex flex-wrap gap-1">
          <SalesOrderStatusBadge status={r.status} />
          {r.isOverdue ? <StatusBadge tone="red">Overdue</StatusBadge> : null}
        </span>
      ),
    },
    {
      header: 'Shipped',
      align: 'right',
      cell: (r) => `${formatCount(r.shipped)} / ${formatCount(r.ordered)}`,
    },
    {
      header: 'Delivered',
      align: 'right',
      cell: (r) => formatCount(r.delivered),
      className: 'hidden md:table-cell',
    },
    {
      header: 'Required by',
      cell: (r) => formatDate(r.requiredDate),
      className: 'hidden lg:table-cell',
    },
    { header: 'Total', align: 'right', cell: (r) => money(r.total) },
  ];

  const s = stats.data;
  const hours = (value: number | null) =>
    value === null
      ? '—'
      : value < 48
        ? `${value.toLocaleString()} h`
        : `${(value / 24).toLocaleString(undefined, { maximumFractionDigits: 1 })} days`;

  return (
    <>
      <ReportFilters filters={filters} show={['warehouseId', 'customerId']} />
      <div className="grid gap-6">
        <Section
          title="Order fulfilment"
          description="For orders created in the range. Dispatch counts are for shipments sent in the range; the open counts below are as of now."
        >
          {s ? (
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatTile
                  label="Orders created"
                  value={formatCount(s.ordersCreated)}
                  detail={`${formatCount(s.ordersConfirmed)} confirmed`}
                />
                <StatTile
                  label="Completed"
                  value={formatCount(s.ordersCompleted)}
                  detail={`${formatCount(s.ordersCancelled)} cancelled`}
                />
                <StatTile
                  label="Confirmation to first dispatch"
                  value={hours(s.averageHoursToDispatch)}
                  detail={`${formatCount(s.shipmentsDispatched)} shipments, ${formatCount(s.unitsShipped)} units sent`}
                />
                <StatTile
                  label="Delivered on time"
                  value={percent(s.onTimeDeliveryRate)}
                  detail={
                    s.averageDaysToDeliver === null
                      ? 'No deliveries yet'
                      : `${s.averageDaysToDeliver.toLocaleString()} days from confirmation on average`
                  }
                />
              </div>
              <div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <span>
                  Open now:{' '}
                  {(['draft', 'confirmed', 'partially_shipped', 'shipped'] as const).map(
                    (status, i) => (
                      <span key={status}>
                        {i > 0 ? ' · ' : ''}
                        <span className="text-foreground font-medium tabular-nums">
                          {s.openByStatus[status] ?? 0}
                        </span>{' '}
                        {SALES_ORDER_STATUS_LABELS[status].toLowerCase()}
                      </span>
                    ),
                  )}
                </span>
                <span>
                  Shipments:{' '}
                  {(['picking', 'picked', 'packed', 'dispatched', 'in_transit'] as const).map(
                    (status, i) => (
                      <span key={status}>
                        {i > 0 ? ' · ' : ''}
                        <span className="text-foreground font-medium tabular-nums">
                          {s.shipmentsByStatus[status] ?? 0}
                        </span>{' '}
                        {SHIPMENT_STATUS_LABELS[status].toLowerCase()}
                      </span>
                    ),
                  )}
                </span>
                <span>
                  Short picks in range:{' '}
                  <span className="text-foreground font-medium tabular-nums">{s.shortPicks}</span>
                </span>
              </div>
            </div>
          ) : (
            <Skeleton className="h-28 w-full" />
          )}
        </Section>

        <Section
          title="Customer order trends"
          description="Orders and their value by confirmation date; units by dispatch date."
          actions={<ExportButton path="/sales/trend" params={params} />}
        >
          <TrendCharts
            trend={trend.data}
            isPending={trend.isPending}
            charts={[
              { keys: ['orders'], title: 'Orders confirmed' },
              { keys: ['value'], title: 'Order value', format: money },
              { keys: ['shipped'], title: 'Units shipped' },
            ]}
          />
        </Section>

        <Section
          title="Top-selling products"
          description="By units dispatched in the range. Revenue is net of line discounts, before tax; cost is the average cost at dispatch."
          actions={<ExportButton path="/sales/top-products" params={topParams} />}
          flush
        >
          <ReportTable
            toolbar={topTable.searchInput('Search top products', 'Search product or SKU')}
            columns={topColumns}
            rows={top.data?.data}
            meta={top.data?.meta}
            isPending={top.isPending}
            isError={top.isError}
            onRetry={() => void top.refetch()}
            onPage={topTable.setPage}
            empty="Nothing shipped in this range."
            rowKey={(r) => r.product.id}
          />
        </Section>

        <Section
          title="Pending and completed orders"
          description="Orders created in the range. Pending: not yet fully shipped. Completed: shipped or delivered."
          actions={<ExportButton path="/sales/orders" params={orderParams} />}
          flush
        >
          <ReportTable
            toolbar={
              <>
                {orderTable.searchInput('Search orders', 'Search number, customer or reference')}
                <FilterSelect
                  label="Filter by state"
                  value={state}
                  onChange={(v) => {
                    setState(v ?? '');
                    orderTable.setPage(1);
                  }}
                  allLabel="Pending and completed"
                  options={[
                    { value: 'pending', label: 'Pending' },
                    { value: 'completed', label: 'Completed' },
                  ]}
                />
              </>
            }
            columns={orderColumns}
            rows={orders.data?.data}
            meta={orders.data?.meta}
            isPending={orders.isPending}
            isError={orders.isError}
            onRetry={() => void orders.refetch()}
            onPage={orderTable.setPage}
            empty="No orders match."
            rowKey={(r) => r.salesOrder.id}
          />
        </Section>
      </div>
    </>
  );
}
