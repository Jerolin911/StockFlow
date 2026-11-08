import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ClipboardCheck } from 'lucide-react';
import { toast } from 'sonner';
import { STOCK_COUNT_STATUSES, STOCK_COUNT_STATUS_LABELS } from '@stockflow/shared';
import { FilterSelect } from '@/components/filters';
import { FormField, fieldA11y } from '@/components/FormField';
import { DialogActions, FormAlert, FormDialog } from '@/components/form-parts';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { FilterBar, TableBodyState } from '@/components/table';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { usePermission } from '@/features/auth/auth-context';
import { useCategoryOptions, useWarehouseOptions } from '@/features/catalog/api';
import { ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { compact, useUrlFilters } from '@/lib/use-url-filters';
import { useCreateStockCount, useStockCounts } from './api';
import { StockCountStatusBadge } from './components';

const ALL = 'all';

export function StockCountsPage() {
  const canCount = usePermission('stock:count');
  const [starting, setStarting] = useState(false);
  const filters = useUrlFilters(['status', 'warehouseId'] as const);
  const warehouses = useWarehouseOptions(true);
  const counts = useStockCounts({ ...compact(filters.values), page: filters.page, pageSize: 25 });
  const rows = counts.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Stock counts"
        description="Physical counts compared with system quantities. Posting applies the variances as an adjustment."
        actions={
          canCount ? (
            <Button onClick={() => setStarting(true)}>
              <ClipboardCheck />
              Start a count
            </Button>
          ) : null
        }
      />
      <Card className="gap-0 overflow-hidden py-0">
        <FilterBar>
          <FilterSelect
            label="Filter by status"
            value={filters.values.status}
            onChange={(status) => filters.update({ status })}
            allLabel="All statuses"
            options={STOCK_COUNT_STATUSES.map((s) => ({
              value: s,
              label: STOCK_COUNT_STATUS_LABELS[s],
            }))}
          />
          <FilterSelect
            label="Filter by warehouse"
            value={filters.values.warehouseId}
            onChange={(warehouseId) => filters.update({ warehouseId })}
            allLabel="All warehouses"
            options={(warehouses.data ?? []).map((w) => ({ value: w.id, label: w.name }))}
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
              <TableHead>Warehouse</TableHead>
              <TableHead className="hidden md:table-cell">Scope</TableHead>
              <TableHead className="text-right">Counted</TableHead>
              <TableHead className="text-right">Variances</TableHead>
              <TableHead className="hidden pr-4 lg:table-cell">Started</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableBodyState
              colSpan={7}
              isPending={counts.isPending}
              isError={counts.isError}
              isEmpty={rows.length === 0}
              onRetry={() => void counts.refetch()}
              emptyMessage={
                filters.active ? 'No counts match these filters.' : 'No stock counts yet.'
              }
            >
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="pl-4">
                    <Link
                      to={`/stock/counts/${c.id}`}
                      className="font-mono text-xs font-medium hover:underline"
                    >
                      {c.number}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StockCountStatusBadge status={c.status} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{c.warehouse.code}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    {c.category?.name ?? 'All products'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.progress.counted} / {c.progress.total}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.progress.withVariance || '—'}
                  </TableCell>
                  <TableCell className="hidden pr-4 lg:table-cell">
                    <div>{c.createdBy.name}</div>
                    <div className="text-muted-foreground text-xs">
                      {formatDateTime(c.createdAt)}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBodyState>
          </TableBody>
        </Table>
        {counts.data && counts.data.meta.total > 0 ? (
          <Pagination
            meta={counts.data.meta}
            onPageChange={(page) => filters.update({ page: String(page) })}
          />
        ) : null}
      </Card>
      <FormDialog
        open={starting}
        onOpenChange={setStarting}
        title="Start a stock count"
        description="Creates a count sheet for every active product held in the warehouse, or one category."
      >
        <StartCountForm onDone={() => setStarting(false)} />
      </FormDialog>
    </>
  );
}

function StartCountForm({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate();
  const warehouses = useWarehouseOptions();
  const categories = useCategoryOptions();
  const create = useCreateStockCount();
  const [warehouseId, setWarehouseId] = useState('');
  const [categoryId, setCategoryId] = useState(ALL);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async () => {
    setFormError(null);
    if (!warehouseId) {
      setErrors({ warehouseId: 'Select a warehouse' });
      return;
    }
    try {
      const count = await create.mutateAsync({
        warehouseId,
        categoryId: categoryId === ALL ? null : categoryId,
        notes,
      });
      toast.success(`${count.number} started: ${count.progress.total} products to count`);
      onDone();
      void navigate(`/stock/counts/${count.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.details.length > 0) {
        setErrors(Object.fromEntries(error.details.map((d) => [d.path, d.message])));
      }
      setFormError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    }
  };

  return (
    <form
      id="start-count"
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <FormAlert message={formError} />
      <FormField id="count-warehouse" label="Warehouse" error={errors.warehouseId}>
        <Select value={warehouseId} onValueChange={setWarehouseId}>
          <SelectTrigger {...fieldA11y('count-warehouse', errors.warehouseId)} className="w-full">
            <SelectValue placeholder="Select a warehouse" />
          </SelectTrigger>
          <SelectContent>
            {(warehouses.data ?? []).map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.code} — {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <FormField id="count-category" label="Products" error={errors.categoryId}>
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger {...fieldA11y('count-category', errors.categoryId)} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All products held here</SelectItem>
            {(categories.data ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>
      <FormField id="count-notes" label="Notes" error={errors.notes}>
        <Textarea
          {...fieldA11y('count-notes', errors.notes)}
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </FormField>
      <DialogActions
        formId="start-count"
        submitLabel="Start count"
        pending={create.isPending}
        onCancel={onDone}
      />
    </form>
  );
}
