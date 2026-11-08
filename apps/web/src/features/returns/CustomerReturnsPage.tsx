import { Link } from 'react-router';
import { Plus } from 'lucide-react';
import {
  CUSTOMER_RETURN_STATUSES,
  CUSTOMER_RETURN_STATUS_LABELS,
  RETURN_REASON_LABELS,
} from '@stockflow/shared';
import { FilterSelect, SearchInput } from '@/components/filters';
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
import { formatDateTime } from '@/lib/format';
import { compact, useUrlFilters } from '@/lib/use-url-filters';
import { useCustomerReturns } from './api';
import { CustomerReturnStatusBadge } from './components';

export function CustomerReturnsPage() {
  const canWrite = usePermission('customerReturns:write');
  const filters = useUrlFilters(['search', 'status'] as const);
  const returns = useCustomerReturns({
    ...compact(filters.values),
    page: filters.page,
    pageSize: 25,
  });
  const rows = returns.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Customer returns"
        description="Goods coming back from customers. Received units wait in quarantine until inspected."
        actions={
          canWrite ? (
            <Button asChild>
              <Link to="/customer-returns/new">
                <Plus />
                New return
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
            placeholder="Search number, order, customer or SKU"
            label="Search customer returns"
          />
          <FilterSelect
            label="Filter by status"
            value={filters.values.status}
            onChange={(status) => filters.update({ status })}
            allLabel="All statuses"
            options={CUSTOMER_RETURN_STATUSES.map((s) => ({
              value: s,
              label: CUSTOMER_RETURN_STATUS_LABELS[s],
            }))}
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
              <TableHead>Status</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="hidden md:table-cell">Reason</TableHead>
              <TableHead className="text-right">Units</TableHead>
              <TableHead className="hidden pr-4 lg:table-cell">Raised</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableBodyState
              colSpan={6}
              isPending={returns.isPending}
              isError={returns.isError}
              isEmpty={rows.length === 0}
              onRetry={() => void returns.refetch()}
              emptyMessage={
                filters.active ? 'No returns match these filters.' : 'No customer returns yet.'
              }
            >
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="pl-4">
                    <Link
                      to={`/customer-returns/${r.id}`}
                      className="font-mono text-xs font-medium hover:underline"
                    >
                      {r.number}
                    </Link>
                    <div className="text-muted-foreground font-mono text-xs">
                      {r.salesOrder.number}
                    </div>
                  </TableCell>
                  <TableCell>
                    <CustomerReturnStatusBadge status={r.status} />
                  </TableCell>
                  <TableCell>{r.customer.name}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    {RETURN_REASON_LABELS[r.reason]}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.status === 'received' || r.status === 'completed'
                      ? r.totals.received
                      : r.totals.requested}
                  </TableCell>
                  <TableCell className="hidden pr-4 lg:table-cell">
                    <div>{r.requestedBy.name}</div>
                    <div className="text-muted-foreground text-xs">
                      {formatDateTime(r.createdAt)}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBodyState>
          </TableBody>
        </Table>
        {returns.data && returns.data.meta.total > 0 ? (
          <Pagination
            meta={returns.data.meta}
            onPageChange={(page) => filters.update({ page: String(page) })}
          />
        ) : null}
      </Card>
    </>
  );
}
