import { Link } from 'react-router';
import type {
  DeliveryRowDto,
  PendingPurchaseRowDto,
  SupplierPerformanceDto,
} from '@stockflow/shared';
import { formatCount } from '@/components/charts';
import { StatusBadge } from '@/components/StatusBadge';
import { useMoney } from '@/features/settings/api';
import { formatDate } from '@/lib/format';
import { usePageTitle } from '@/lib/use-page-title';
import { useReportPage, useTrend } from './api';
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

export function PurchasingReportsPage() {
  usePageTitle('Procurement analytics');
  const money = useMoney();
  const filters = useReportFilters();
  const { params } = filters;
  const trend = useTrend('/purchasing/trend', params);

  const supplierTable = useTableState();
  const supplierParams = {
    ...params,
    search: supplierTable.search,
    page: supplierTable.page,
    pageSize: supplierTable.pageSize,
  };
  const suppliers = useReportPage<SupplierPerformanceDto>('/purchasing/suppliers', supplierParams);

  const pendingTable = useTableState();
  const pendingParams = {
    supplierId: params.supplierId,
    warehouseId: params.warehouseId,
    search: pendingTable.search,
    page: pendingTable.page,
    pageSize: pendingTable.pageSize,
  };
  const pending = useReportPage<PendingPurchaseRowDto>('/purchasing/pending', pendingParams);

  const deliveryTable = useTableState();
  const deliveryParams = {
    ...params,
    search: deliveryTable.search,
    page: deliveryTable.page,
    pageSize: deliveryTable.pageSize,
  };
  const deliveries = useReportPage<DeliveryRowDto>('/purchasing/deliveries', deliveryParams);

  const supplierColumns: Column<SupplierPerformanceDto>[] = [
    {
      header: 'Supplier',
      cell: (r) => (
        <Link to={`/suppliers/${r.supplier.id}`} className="font-medium hover:underline">
          {r.supplier.name}
        </Link>
      ),
    },
    { header: 'Orders', align: 'right', cell: (r) => formatCount(r.orders) },
    {
      header: 'Value ordered',
      align: 'right',
      cell: (r) => money(r.orderedValue),
      className: 'hidden lg:table-cell',
    },
    { header: 'Deliveries', align: 'right', cell: (r) => formatCount(r.receipts) },
    {
      header: 'On time',
      align: 'right',
      cell: (r) => (
        <>
          {percent(r.onTimeRate)}
          {r.late > 0 ? <div className="text-muted-foreground text-xs">{r.late} late</div> : null}
        </>
      ),
    },
    {
      header: 'Avg days late',
      align: 'right',
      cell: (r) => (r.averageDaysLate === null ? '—' : r.averageDaysLate.toLocaleString()),
      className: 'hidden md:table-cell',
    },
    {
      header: 'Rejected or damaged',
      align: 'right',
      cell: (r) => (
        <>
          {percent(r.issueRate)}
          {r.rejectedUnits + r.damagedUnits > 0 ? (
            <div className="text-muted-foreground text-xs">
              {formatCount(r.rejectedUnits + r.damagedUnits)} units
            </div>
          ) : null}
        </>
      ),
    },
    {
      header: 'Open',
      align: 'right',
      cell: (r) => (
        <>
          {r.openOrders}
          {r.overdueOrders > 0 ? (
            <div className="text-xs text-red-700">{r.overdueOrders} overdue</div>
          ) : null}
        </>
      ),
    },
  ];

  const pendingColumns: Column<PendingPurchaseRowDto>[] = [
    {
      header: 'Order',
      cell: (r) => (
        <>
          <Link
            to={`/purchase-orders/${r.purchaseOrder.id}`}
            className="font-mono text-xs font-medium hover:underline"
          >
            {r.purchaseOrder.number}
          </Link>
          <div className="text-muted-foreground text-xs">
            {r.supplier.name} · {r.warehouse.code}
          </div>
        </>
      ),
    },
    {
      header: 'Product',
      cell: (r) => (
        <>
          <div className="font-medium">{r.product.name}</div>
          <div className="text-muted-foreground font-mono text-xs">{r.product.sku}</div>
        </>
      ),
    },
    {
      header: 'Ordered',
      align: 'right',
      cell: (r) => formatCount(r.ordered),
      className: 'hidden md:table-cell',
    },
    {
      header: 'Received',
      align: 'right',
      cell: (r) => formatCount(r.received),
      className: 'hidden md:table-cell',
    },
    {
      header: 'Pending',
      align: 'right',
      cell: (r) => <span className="font-medium">{formatCount(r.pending)}</span>,
    },
    {
      header: 'Expected',
      cell: (r) => (
        <span className={r.isOverdue ? 'text-red-700' : undefined}>
          {formatDate(r.expectedDate)}
          {r.isOverdue ? (
            <StatusBadge tone="red" className="ml-2">
              Overdue
            </StatusBadge>
          ) : null}
        </span>
      ),
    },
  ];

  const deliveryColumns: Column<DeliveryRowDto>[] = [
    {
      header: 'Receipt',
      cell: (r) => (
        <>
          <Link
            to={`/goods-receipts/${r.receipt.id}`}
            className="font-mono text-xs font-medium hover:underline"
          >
            {r.receipt.number}
          </Link>
          <div className="text-muted-foreground font-mono text-xs">{r.purchaseOrder.number}</div>
        </>
      ),
    },
    { header: 'Supplier', cell: (r) => r.supplier.name },
    { header: 'Received', cell: (r) => formatDate(r.receivedAt) },
    {
      header: 'Expected',
      cell: (r) => formatDate(r.expectedDate),
      className: 'hidden md:table-cell',
    },
    {
      header: 'Timing',
      cell: (r) =>
        r.daysLate === null ? (
          '—'
        ) : r.daysLate > 0 ? (
          <StatusBadge tone="red">{r.daysLate} days late</StatusBadge>
        ) : (
          <StatusBadge tone="green">On time</StatusBadge>
        ),
    },
    { header: 'Accepted', align: 'right', cell: (r) => formatCount(r.acceptedUnits) },
    {
      header: 'Rejected / damaged',
      align: 'right',
      cell: (r) => formatCount(r.rejectedUnits + r.damagedUnits),
      className: 'hidden lg:table-cell',
    },
  ];

  return (
    <>
      <ReportFilters filters={filters} show={['warehouseId', 'supplierId']} />
      <div className="grid gap-6">
        <Section
          title="Purchase order trends"
          description="Orders raised (drafts and cancellations excluded), their value, and units accepted into stock."
          actions={<ExportButton path="/purchasing/trend" params={params} />}
        >
          <TrendCharts
            trend={trend.data}
            isPending={trend.isPending}
            charts={[
              { keys: ['orders'], title: 'Orders raised' },
              { keys: ['value'], title: 'Value ordered', format: money },
              { keys: ['received'], title: 'Units received' },
            ]}
          />
        </Section>

        <Section
          title="Supplier delivery performance"
          description="Deliveries in the range against each order's expected date, and the share of delivered units rejected or damaged. Open and overdue orders are as of today."
          actions={<ExportButton path="/purchasing/suppliers" params={supplierParams} />}
          flush
        >
          <ReportTable
            toolbar={supplierTable.searchInput('Search suppliers', 'Search supplier')}
            columns={supplierColumns}
            rows={suppliers.data?.data}
            meta={suppliers.data?.meta}
            isPending={suppliers.isPending}
            isError={suppliers.isError}
            onRetry={() => void suppliers.refetch()}
            onPage={supplierTable.setPage}
            empty="No supplier activity in this range."
            rowKey={(r) => r.supplier.id}
          />
        </Section>

        <Section
          title="Pending purchase quantities"
          description="Units still due on approved purchase orders, soonest first."
          actions={<ExportButton path="/purchasing/pending" params={pendingParams} />}
          flush
        >
          <ReportTable
            toolbar={pendingTable.searchInput(
              'Search pending lines',
              'Search order, product or supplier',
            )}
            columns={pendingColumns}
            rows={pending.data?.data}
            meta={pending.data?.meta}
            isPending={pending.isPending}
            isError={pending.isError}
            onRetry={() => void pending.refetch()}
            onPage={pendingTable.setPage}
            empty="Nothing is waiting to arrive."
            rowKey={(r) => `${r.purchaseOrder.id}:${r.product.id}`}
          />
        </Section>

        <Section
          title="Supplier delivery history"
          description="Goods receipts in the range."
          actions={<ExportButton path="/purchasing/deliveries" params={deliveryParams} />}
          flush
        >
          <ReportTable
            toolbar={deliveryTable.searchInput(
              'Search deliveries',
              'Search receipt, order or supplier',
            )}
            columns={deliveryColumns}
            rows={deliveries.data?.data}
            meta={deliveries.data?.meta}
            isPending={deliveries.isPending}
            isError={deliveries.isError}
            onRetry={() => void deliveries.refetch()}
            onPage={deliveryTable.setPage}
            empty="No deliveries in this range."
            rowKey={(r) => r.receipt.id}
          />
        </Section>
      </div>
    </>
  );
}
