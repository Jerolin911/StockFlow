import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import {
  ADJUSTMENT_REASONS,
  ADJUSTMENT_REASON_LABELS,
  type AdjustmentReason,
  type QuarantineAction,
} from '@stockflow/shared';
import { FilterSelect, SearchInput } from '@/components/filters';
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
import { useWarehouseOptions } from '@/features/catalog/api';
import { useAvailability } from '@/features/sales/api';
import { useQuarantine, usePostQuarantineAction } from '@/features/stock/api';
import { ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { compact, useUrlFilters } from '@/lib/use-url-filters';
import {
  QuantityLinesEditor,
  newQuantityLine,
  toQuantityInput,
  validateQuantityLines,
  type QuantityLine,
} from './components';

const ACTION_LABELS: Record<QuarantineAction, string> = {
  quarantine: 'Move usable stock into quarantine',
  release: 'Release back to usable stock',
  write_off: 'Write off (scrap)',
};

interface Preset {
  action: QuarantineAction;
  warehouseId: string;
  productId: string;
  quantity: number;
}

export function QuarantinePage() {
  const canAdjust = usePermission('stock:adjust');
  const filters = useUrlFilters(['search', 'warehouseId'] as const);
  const warehouses = useWarehouseOptions(true);
  const levels = useQuarantine({ ...compact(filters.values), page: filters.page, pageSize: 25 });
  const rows = levels.data?.data ?? [];
  const [preset, setPreset] = useState<Preset | 'new' | null>(null);

  return (
    <>
      <PageHeader
        title="Quarantine"
        description="Damaged goods and returns awaiting a decision. Quarantined units are in the warehouse but never available to sell."
        actions={
          canAdjust ? (
            <Button onClick={() => setPreset('new')}>
              <ShieldAlert />
              Record a quarantine change
            </Button>
          ) : null
        }
      />
      <Card className="gap-0 overflow-hidden py-0">
        <FilterBar>
          <SearchInput
            value={filters.values.search}
            onChange={(search) => filters.update({ search })}
            placeholder="Search product or SKU"
            label="Search quarantine"
          />
          <FilterSelect
            label="Filter by warehouse"
            value={filters.values.warehouseId}
            onChange={(warehouseId) => filters.update({ warehouseId })}
            allLabel="All warehouses"
            options={(warehouses.data ?? []).map((w) => ({ value: w.id, label: w.name }))}
          />
        </FilterBar>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Product</TableHead>
              <TableHead>Warehouse</TableHead>
              <TableHead className="text-right">In quarantine</TableHead>
              <TableHead className="hidden text-right md:table-cell">Usable on hand</TableHead>
              <TableHead className="hidden lg:table-cell">Last change</TableHead>
              {canAdjust ? <TableHead className="pr-4 text-right">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableBodyState
              colSpan={canAdjust ? 6 : 5}
              isPending={levels.isPending}
              isError={levels.isError}
              isEmpty={rows.length === 0}
              onRetry={() => void levels.refetch()}
              emptyMessage="Nothing is in quarantine."
            >
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="pl-4">
                    <Link
                      to={`/products/${row.product.id}`}
                      className="font-medium hover:underline"
                    >
                      {row.product.name}
                    </Link>
                    <div className="text-muted-foreground font-mono text-xs">{row.product.sku}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.warehouse.code}</TableCell>
                  <TableCell className="text-right font-medium text-amber-800 tabular-nums">
                    {row.quarantine} {row.product.unit}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">
                    {row.onHand}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {formatDateTime(row.updatedAt)}
                  </TableCell>
                  {canAdjust ? (
                    <TableCell className="pr-4 text-right">
                      <div className="flex justify-end gap-1">
                        {(['release', 'write_off'] as const).map((action) => (
                          <Button
                            key={action}
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setPreset({
                                action,
                                warehouseId: row.warehouse.id,
                                productId: row.product.id,
                                quantity: row.quarantine,
                              })
                            }
                          >
                            {action === 'release' ? 'Release' : 'Write off'}
                          </Button>
                        ))}
                        <Button variant="ghost" size="sm" asChild>
                          <Link
                            to={`/supplier-returns/new?warehouseId=${row.warehouse.id}&productId=${row.product.id}&quantity=${row.quarantine}`}
                          >
                            Return to supplier
                          </Link>
                        </Button>
                      </div>
                    </TableCell>
                  ) : null}
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
      <FormDialog
        open={preset !== null}
        onOpenChange={(open) => !open && setPreset(null)}
        title="Quarantine change"
        description="Each change is posted as a numbered document with stock movements."
        wide
      >
        <QuarantineForm preset={preset === 'new' ? null : preset} onDone={() => setPreset(null)} />
      </FormDialog>
    </>
  );
}

function QuarantineForm({ preset, onDone }: { preset: Preset | null; onDone: () => void }) {
  const navigate = useNavigate();
  const warehouses = useWarehouseOptions();
  const post = usePostQuarantineAction();
  const [action, setAction] = useState<QuarantineAction>(preset?.action ?? 'quarantine');
  const [warehouseId, setWarehouseId] = useState(preset?.warehouseId ?? '');
  const [reason, setReason] = useState<AdjustmentReason | ''>(
    preset?.action === 'release' ? 'correction' : preset ? 'damage' : '',
  );
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<QuantityLine[]>(() => [
    newQuantityLine(
      preset ? { productId: preset.productId, quantity: String(preset.quantity) } : {},
    ),
  ]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const availability = useAvailability(lines.map((l) => l.productId));

  const submit = async () => {
    setFormError(null);
    const issues = validateQuantityLines(lines);
    if (!warehouseId) issues.warehouseId = 'Select a warehouse';
    if (!reason) issues.reason = 'Select a reason';
    setErrors(issues);
    if (Object.keys(issues).length > 0) return;
    try {
      const doc = await post.mutateAsync({
        warehouseId,
        action,
        reason: reason as AdjustmentReason,
        notes,
        lines: toQuantityInput(lines),
      });
      toast.success(`${doc.number} posted`);
      onDone();
      void navigate(`/stock/adjustments/${doc.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.details.length > 0) {
        setErrors(Object.fromEntries(error.details.map((d) => [d.path, d.message])));
      }
      setFormError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    }
  };

  return (
    <form
      id="quarantine-form"
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <FormAlert message={formError} />
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField id="qtn-action" label="Change" error={errors.action}>
          <Select value={action} onValueChange={(v) => setAction(v as QuarantineAction)}>
            <SelectTrigger {...fieldA11y('qtn-action', errors.action)} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ACTION_LABELS) as QuarantineAction[]).map((a) => (
                <SelectItem key={a} value={a}>
                  {ACTION_LABELS[a]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField id="qtn-warehouse" label="Warehouse" error={errors.warehouseId}>
          <Select value={warehouseId} onValueChange={setWarehouseId}>
            <SelectTrigger {...fieldA11y('qtn-warehouse', errors.warehouseId)} className="w-full">
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
        <FormField id="qtn-reason" label="Reason" error={errors.reason}>
          <Select value={reason} onValueChange={(v) => setReason(v as AdjustmentReason)}>
            <SelectTrigger {...fieldA11y('qtn-reason', errors.reason)} className="w-full">
              <SelectValue placeholder="Select a reason" />
            </SelectTrigger>
            <SelectContent>
              {ADJUSTMENT_REASONS.filter((r) => r !== 'count').map((r) => (
                <SelectItem key={r} value={r}>
                  {ADJUSTMENT_REASON_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </div>
      <QuantityLinesEditor
        lines={lines}
        onChange={setLines}
        errors={errors}
        warehouseId={warehouseId}
        availability={availability.data}
        stockColumn={action === 'quarantine' ? 'available' : 'quarantine'}
      />
      <FormField id="qtn-notes" label="Notes" error={errors.notes}>
        <Textarea
          {...fieldA11y('qtn-notes', errors.notes)}
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </FormField>
      <DialogActions
        formId="quarantine-form"
        submitLabel="Post"
        pending={post.isPending}
        onCancel={onDone}
      />
    </form>
  );
}
