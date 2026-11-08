import { useState, type ReactNode } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { TrendDto } from '@stockflow/shared';
import { ColumnChart, type ColumnPoint } from '@/components/charts';
import { FilterSelect, SearchInput } from '@/components/filters';
import { Pagination } from '@/components/Pagination';
import { TableBodyState } from '@/components/table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCategoryOptions, useWarehouseOptions } from '@/features/catalog/api';
import { usePartners } from '@/features/partners/api';
import { ApiError, type RequestOptions } from '@/lib/api-client';
import { useUrlFilters } from '@/lib/use-url-filters';
import { cn } from '@/lib/utils';
import { downloadReport } from './api';

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysBefore = (dayIso: string, days: number) =>
  iso(new Date(Date.parse(dayIso + 'T00:00:00Z') - days * DAY));

export const PRESETS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '12 months' },
];

export type FilterKey = 'warehouseId' | 'categoryId' | 'supplierId' | 'customerId';

/** Report filters kept in the URL; the server defaults the range to the last 30 days. */
export function useReportFilters() {
  const filters = useUrlFilters([
    'from',
    'to',
    'warehouseId',
    'categoryId',
    'supplierId',
    'customerId',
  ] as const);
  const params = Object.fromEntries(
    Object.entries(filters.values).filter(([, v]) => v !== ''),
  ) as Record<string, string>;
  return { ...filters, params };
}

/** One row of filters above every chart on the tab. */
export function ReportFilters({
  filters,
  show,
}: {
  filters: ReturnType<typeof useReportFilters>;
  show: FilterKey[];
}) {
  const warehouses = useWarehouseOptions(true);
  const categories = useCategoryOptions();
  const suppliers = usePartners('suppliers', { pageSize: 100, sort: 'name' });
  const customers = usePartners('customers', { pageSize: 100, sort: 'name' });
  const today = iso(new Date());
  const from = filters.values.from;
  const to = filters.values.to;
  const activePreset = PRESETS.find(
    (p) => (to === '' || to === today) && from === daysBefore(today, p.days - 1),
  );
  const isDefault = from === '' && to === '';

  return (
    <Card className="mb-6 py-4">
      <CardContent className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Date range">
          {PRESETS.map((p) => (
            <Button
              key={p.days}
              size="sm"
              variant={
                activePreset?.days === p.days || (isDefault && p.days === 30)
                  ? 'default'
                  : 'outline'
              }
              onClick={() => filters.update({ from: daysBefore(today, p.days - 1), to: '' })}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <div className="grid gap-1">
          <Label htmlFor="report-from" className="text-xs">
            From
          </Label>
          <Input
            id="report-from"
            type="date"
            className="h-8 w-40"
            max={to || today}
            value={from}
            onChange={(event) => filters.update({ from: event.target.value })}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="report-to" className="text-xs">
            To
          </Label>
          <Input
            id="report-to"
            type="date"
            className="h-8 w-40"
            min={from || undefined}
            max={today}
            value={to}
            onChange={(event) => filters.update({ to: event.target.value })}
          />
        </div>
        {show.includes('warehouseId') ? (
          <FilterSelect
            label="Filter by warehouse"
            value={filters.values.warehouseId}
            onChange={(warehouseId) => filters.update({ warehouseId })}
            allLabel="All warehouses"
            options={(warehouses.data ?? []).map((w) => ({ value: w.id, label: w.name }))}
          />
        ) : null}
        {show.includes('categoryId') ? (
          <FilterSelect
            label="Filter by category"
            value={filters.values.categoryId}
            onChange={(categoryId) => filters.update({ categoryId })}
            allLabel="All categories"
            options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          />
        ) : null}
        {show.includes('supplierId') ? (
          <FilterSelect
            label="Filter by supplier"
            value={filters.values.supplierId}
            onChange={(supplierId) => filters.update({ supplierId })}
            allLabel="All suppliers"
            options={(suppliers.data?.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          />
        ) : null}
        {show.includes('customerId') ? (
          <FilterSelect
            label="Filter by customer"
            value={filters.values.customerId}
            onChange={(customerId) => filters.update({ customerId })}
            allLabel="All customers"
            options={(customers.data?.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          />
        ) : null}
        {filters.active ? (
          <Button variant="ghost" size="sm" onClick={filters.clear}>
            Reset
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ExportButton({ path, params }: { path: string; params: RequestOptions['query'] }) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          await downloadReport(path, params);
        } catch (error) {
          toast.error(error instanceof ApiError ? error.message : 'Export failed');
        } finally {
          setPending(false);
        }
      }}
    >
      {pending ? <Loader2 className="animate-spin" /> : <Download />}
      CSV
    </Button>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  flush,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** Edge-to-edge content (tables). */
  flush?: boolean;
  className?: string;
}) {
  return (
    <Card className={cn(flush && 'gap-0 overflow-hidden pb-0', className)}>
      <CardHeader className={cn(flush && 'pb-4')}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>{title}</CardTitle>
            {description ? <CardDescription className="mt-1">{description}</CardDescription> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      </CardHeader>
      {flush ? children : <CardContent>{children}</CardContent>}
    </Card>
  );
}

const shortDate = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const monthYear = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  year: '2-digit',
  timeZone: 'UTC',
});

/** Period labels for a trend: "3 Nov" for days and weeks, "Nov 26" for months. */
export function trendPoints(trend: TrendDto): ColumnPoint[] {
  return trend.points.map((p) => {
    const date = new Date(`${p.period}T00:00:00Z`);
    return {
      key: p.period,
      label: trend.interval === 'month' ? monthYear.format(date) : shortDate.format(date),
      values: p.values,
    };
  });
}

/** A trend card: one chart per series when their units differ, never two scales on one axis. */
export function TrendCharts({
  trend,
  isPending,
  charts,
}: {
  trend: TrendDto | undefined;
  isPending: boolean;
  charts: { keys: string[]; title: string; format?: (value: number) => string }[];
}) {
  if (!trend) {
    return isPending ? (
      <Skeleton className="h-52 w-full" />
    ) : (
      <p className="text-destructive text-sm">Couldn't load this chart.</p>
    );
  }
  const points = trendPoints(trend);
  const interval =
    trend.interval === 'day' ? 'Daily' : trend.interval === 'week' ? 'Weekly' : 'Monthly';
  return (
    <div className={cn('grid gap-6', charts.length > 1 && 'lg:grid-cols-2 2xl:grid-cols-3')}>
      {charts.map((chart) => (
        <div key={chart.title} className="min-w-0">
          <p className="mb-2 text-sm font-medium">
            {chart.title} <span className="text-muted-foreground font-normal">· {interval}</span>
          </p>
          <ColumnChart
            label={chart.title}
            points={points}
            series={trend.series.filter((s) => chart.keys.includes(s.key))}
            {...(chart.format ? { format: chart.format } : {})}
          />
        </div>
      ))}
    </div>
  );
}

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  align?: 'right';
  className?: string;
}

/** Paged table with optional search and extra filters, all owned by the caller's state. */
export function ReportTable<T>({
  columns,
  rows,
  meta,
  isPending,
  isError,
  onRetry,
  onPage,
  empty,
  rowKey,
  toolbar,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  meta?: { page: number; pageSize: number; total: number } | undefined;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  onPage?: (page: number) => void;
  empty: string;
  rowKey: (row: T) => string;
  toolbar?: ReactNode;
}) {
  return (
    <>
      {toolbar ? (
        <div className="flex flex-wrap items-center gap-2 border-y px-4 py-3">{toolbar}</div>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c, i) => (
              <TableHead
                key={c.header}
                className={cn(
                  c.align === 'right' && 'text-right',
                  i === 0 && 'pl-6',
                  i === columns.length - 1 && 'pr-6',
                  c.className,
                )}
              >
                {c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableBodyState
            colSpan={columns.length}
            isPending={isPending && !rows}
            isError={isError}
            isEmpty={(rows ?? []).length === 0}
            onRetry={onRetry}
            emptyMessage={empty}
          >
            {(rows ?? []).map((row) => (
              <TableRow key={rowKey(row)}>
                {columns.map((c, i) => (
                  <TableCell
                    key={c.header}
                    className={cn(
                      c.align === 'right' && 'text-right tabular-nums',
                      i === 0 && 'pl-6',
                      i === columns.length - 1 && 'pr-6',
                      c.className,
                    )}
                  >
                    {c.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBodyState>
        </TableBody>
      </Table>
      {meta && onPage && meta.total > 0 ? <Pagination meta={meta} onPageChange={onPage} /> : null}
    </>
  );
}

/** Local search + page state for a table inside a report tab. */
export function useTableState(pageSize = 10) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  return {
    search,
    page,
    pageSize,
    setPage,
    setSearch: (value: string | undefined) => {
      setSearch(value ?? '');
      setPage(1);
    },
    searchInput: (label: string, placeholder: string) => (
      <SearchInput
        value={search}
        onChange={(value) => {
          setSearch(value ?? '');
          setPage(1);
        }}
        placeholder={placeholder}
        label={label}
      />
    ),
  };
}

export const percent = (value: number | null) =>
  value === null
    ? '—'
    : `${(value * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
