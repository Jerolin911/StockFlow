import { Link } from 'react-router';
import { Plus } from 'lucide-react';
import {
  RETURN_REASON_LABELS,
  SUPPLIER_RETURN_STATUSES,
  SUPPLIER_RETURN_STATUS_LABELS,
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
import { useSupplierReturns } from './api';
import { SupplierReturnStatusBadge } from './components';

export function SupplierReturnsPage() {
  const canWrite = usePermission('supplierReturns:write');
  const filters = useUrlFilters(['search', 'status'] as const);
  const returns = useSupplierReturns({
    ...compact(filters.values),
    page: filters.page,
    pageSize: 25,
  });
  const rows = returns.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Supplier returns"
        description="Defective, damaged or wrong goods sent back to suppliers, from quarantine or usable stock."
        actions={
          canWrite ? (
            <Button asChild>
              <Link to="/supplier-returns/new">
                <Plus />
                New supplier return
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
            placeholder="Search number, supplier, order or SKU"
            label="Search supplier returns"
          />
          <FilterSelect
            label="Filter by status"
            value={filters.values.status}
            onChange={(status) => filters.update({ status })}
            allLabel="All statuses"
            options={SUPPLIER_RETURN_STATUSES.map((s) => ({
              value: s,
              label: SUPPLIER_RETURN_STATUS_LABELS[s],
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
              <TableHead>Supplier</TableHead>
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
                filters.active ? 'No returns match these filters.' : 'No supplier returns yet.'
              }
            >
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="pl-4">
                    <Link
                      to={`/supplier-returns/${r.id}`}
                      className="font-mono text-xs font-medium hover:underline"
                    >
                      {r.number}
                    </Link>
                    <div className="text-muted-foreground font-mono text-xs">
                      {r.warehouse.code}
                    </div>
                  </TableCell>
                  <TableCell>
                    <SupplierReturnStatusBadge status={r.status} />
                  </TableCell>
                  <TableCell>{r.supplier.name}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    {RETURN_REASON_LABELS[r.reason]}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.totalQuantity}</TableCell>
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
