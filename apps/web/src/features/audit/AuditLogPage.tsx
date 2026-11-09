import { Link } from 'react-router';
import { ROLE_LABELS, type AuditLogDto, type Role } from '@stockflow/shared';
import { FilterSelect, SearchInput } from '@/components/filters';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { StatusBadge } from '@/components/StatusBadge';
import { FilterBar, TableBodyState } from '@/components/table';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';
import { useListQuery } from '@/lib/query';
import { compact, useUrlFilters } from '@/lib/use-url-filters';

/** Where an audited record can be opened, by the first segment of its route. */
const RECORD_PATHS: Record<string, string> = {
  products: '/products',
  suppliers: '/suppliers',
  'purchase-requests': '/purchase-requests',
  'purchase-orders': '/purchase-orders',
  'goods-receipts': '/goods-receipts',
  'sales-orders': '/sales-orders',
  shipments: '/shipments',
  'stock-transfers': '/stock/transfers',
  'stock-counts': '/stock/counts',
  'customer-returns': '/customer-returns',
  'supplier-returns': '/supplier-returns',
};

const AREAS = [
  'auth',
  'users',
  'settings',
  'warehouses',
  'categories',
  'products',
  'suppliers',
  'customers',
  'stock',
  'purchase-requests',
  'purchase-orders',
  'goods-receipts',
  'sales-orders',
  'shipments',
  'stock-transfers',
  'stock-counts',
  'customer-returns',
  'supplier-returns',
];

const label = (area: string) => area.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function recordLink(row: AuditLogDto) {
  if (!row.entityId) return null;
  const base = RECORD_PATHS[row.entityType];
  if (row.entityType === 'stock' && row.path.startsWith('/stock/adjustments')) {
    return `/stock/adjustments/${row.entityId}`;
  }
  return base ? `${base}/${row.entityId}` : null;
}

export function AuditLogPage() {
  const filters = useUrlFilters(['search', 'entityType', 'outcome', 'from', 'to'] as const);
  const logs = useListQuery<AuditLogDto>('audit-logs', '/audit-logs', {
    ...compact(filters.values),
    page: filters.page,
    pageSize: 50,
  });
  const rows = logs.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every successful change and every sign-in attempt: who, when, what and from where. Document histories and the stock ledger hold the business detail."
      />
      <Card className="gap-0 overflow-hidden py-0">
        <FilterBar>
          <SearchInput
            value={filters.values.search}
            onChange={(search) => filters.update({ search })}
            placeholder="Search user, email or action"
            label="Search the audit log"
          />
          <FilterSelect
            label="Filter by area"
            value={filters.values.entityType}
            onChange={(entityType) => filters.update({ entityType })}
            allLabel="All areas"
            options={AREAS.map((a) => ({ value: a, label: label(a) }))}
          />
          <FilterSelect
            label="Filter by outcome"
            value={filters.values.outcome}
            onChange={(outcome) => filters.update({ outcome })}
            allLabel="All outcomes"
            options={[{ value: 'failed', label: 'Failed sign-ins' }]}
          />
          <Input
            type="date"
            aria-label="From date"
            className="w-40"
            value={filters.values.from}
            onChange={(event) => filters.update({ from: event.target.value })}
          />
          <Input
            type="date"
            aria-label="To date"
            className="w-40"
            value={filters.values.to}
            onChange={(event) => filters.update({ to: event.target.value })}
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
              <TableHead className="pl-4">When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Action</TableHead>
              <TableHead className="hidden md:table-cell">Record</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead className="hidden pr-4 lg:table-cell">IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableBodyState
              colSpan={6}
              isPending={logs.isPending}
              isError={logs.isError}
              isEmpty={rows.length === 0}
              onRetry={() => void logs.refetch()}
              emptyMessage={
                filters.active ? 'No entries match these filters.' : 'Nothing recorded yet.'
              }
            >
              {rows.map((row) => {
                const link = recordLink(row);
                return (
                  <TableRow key={row.id}>
                    <TableCell className="pl-4 whitespace-nowrap">
                      {formatDateTime(row.at)}
                    </TableCell>
                    <TableCell>
                      {row.actor?.name ? (
                        <>
                          <div>{row.actor.name}</div>
                          <div className="text-muted-foreground text-xs">
                            {ROLE_LABELS[row.actor.role as Role] ?? row.actor.role}
                          </div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">
                          {row.actor?.email || 'Unknown'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs">
                        {row.method} {row.action}
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {link ? (
                        <Link to={link} className="font-mono text-xs hover:underline">
                          {row.entityId}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground font-mono text-xs">
                          {row.entityId ?? '—'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.status >= 400 ? (
                        <StatusBadge tone="red">Failed ({row.status})</StatusBadge>
                      ) : (
                        <StatusBadge tone="green">OK</StatusBadge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden pr-4 font-mono text-xs lg:table-cell">
                      {row.ip}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBodyState>
          </TableBody>
        </Table>
        {logs.data && logs.data.meta.total > 0 ? (
          <Pagination
            meta={logs.data.meta}
            onPageChange={(page) => filters.update({ page: String(page) })}
          />
        ) : null}
      </Card>
    </>
  );
}
