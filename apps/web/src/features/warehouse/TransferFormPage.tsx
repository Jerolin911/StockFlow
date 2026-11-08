import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { TransferDto } from '@stockflow/shared';
import { BackLink } from '@/components/BackLink';
import { FormField, fieldA11y } from '@/components/FormField';
import { FormAlert } from '@/components/form-parts';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useWarehouseOptions } from '@/features/catalog/api';
import { useAvailability } from '@/features/sales/api';
import { ApiError } from '@/lib/api-client';
import { useSaveTransfer, useTransfer } from './api';
import {
  QuantityLinesEditor,
  newQuantityLine,
  toQuantityInput,
  validateQuantityLines,
  type QuantityLine,
} from './components';

export function TransferFormPage() {
  const { id } = useParams<{ id: string }>();
  const existing = useTransfer(id);
  if (id && !existing.data) {
    return existing.isError ? (
      <p className="text-destructive text-sm">Couldn't load this transfer.</p>
    ) : (
      <Skeleton className="h-64 w-full" />
    );
  }
  if (existing.data && existing.data.status !== 'requested') {
    return (
      <p className="text-muted-foreground text-sm">
        Only requests awaiting approval can be edited.
      </p>
    );
  }
  return <TransferForm key={id ?? 'new'} transfer={existing.data ?? null} />;
}

function TransferForm({ transfer }: { transfer: TransferDto | null }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const warehouses = useWarehouseOptions();
  const save = useSaveTransfer();
  const [fromWarehouseId, setFrom] = useState(
    transfer?.fromWarehouse.id ?? params.get('fromWarehouseId') ?? '',
  );
  const [toWarehouseId, setTo] = useState(
    transfer?.toWarehouse.id ?? params.get('toWarehouseId') ?? '',
  );
  const [neededBy, setNeededBy] = useState(transfer?.neededBy ?? '');
  const [notes, setNotes] = useState(transfer?.notes ?? '');
  const [lines, setLines] = useState<QuantityLine[]>(() =>
    transfer
      ? transfer.lines.map((l) =>
          newQuantityLine({ productId: l.productId, quantity: String(l.quantity) }),
        )
      : [newQuantityLine({ productId: params.get('productId') ?? '' })],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const availability = useAvailability(lines.map((l) => l.productId));

  const submit = async () => {
    setFormError(null);
    const issues = validateQuantityLines(lines);
    if (!fromWarehouseId) issues.fromWarehouseId = 'Select the source';
    if (!toWarehouseId) issues.toWarehouseId = 'Select the destination';
    else if (toWarehouseId === fromWarehouseId) {
      issues.toWarehouseId = 'Choose a different warehouse from the source';
    }
    setErrors(issues);
    if (Object.keys(issues).length > 0) return;
    setPending(true);
    try {
      const saved = await save.mutateAsync({
        ...(transfer ? { id: transfer.id } : {}),
        fromWarehouseId,
        toWarehouseId,
        neededBy: neededBy || null,
        notes,
        lines: toQuantityInput(lines),
      });
      toast.success(transfer ? `${saved.number} updated` : `${saved.number} sent for approval`);
      void navigate(`/stock/transfers/${saved.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.details.length > 0) {
        setErrors(Object.fromEntries(error.details.map((d) => [d.path, d.message])));
      }
      setFormError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    } finally {
      setPending(false);
    }
  };

  const warehouseSelect = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    error: string | undefined,
  ) => (
    <FormField id={id} label={label} error={error}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger {...fieldA11y(id, error)} className="w-full">
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
  );

  return (
    <>
      <BackLink
        to={transfer ? `/stock/transfers/${transfer.id}` : '/stock/transfers'}
        label={transfer ? transfer.number : 'Transfers'}
      />
      <PageHeader
        title={transfer ? `Edit ${transfer.number}` : 'New transfer request'}
        description="Requests need approval before stock is dispatched. Availability shown is for the source warehouse."
      />
      <form
        noValidate
        className="grid gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <FormAlert message={formError} />
        <Card>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {warehouseSelect('trf-from', 'From', fromWarehouseId, setFrom, errors.fromWarehouseId)}
            {warehouseSelect('trf-to', 'To', toWarehouseId, setTo, errors.toWarehouseId)}
            <FormField id="trf-needed" label="Needed by" error={errors.neededBy}>
              <Input
                {...fieldA11y('trf-needed', errors.neededBy)}
                type="date"
                value={neededBy}
                onChange={(event) => setNeededBy(event.target.value)}
              />
            </FormField>
            <div className="sm:col-span-2 lg:col-span-3">
              <FormField id="trf-notes" label="Notes" error={errors.notes}>
                <Textarea
                  {...fieldA11y('trf-notes', errors.notes)}
                  rows={2}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </FormField>
            </div>
          </CardContent>
        </Card>
        <QuantityLinesEditor
          lines={lines}
          onChange={setLines}
          errors={errors}
          warehouseId={fromWarehouseId}
          availability={availability.data}
          stockColumn="available"
        />
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            {transfer ? 'Save changes' : 'Request transfer'}
          </Button>
        </div>
      </form>
    </>
  );
}
