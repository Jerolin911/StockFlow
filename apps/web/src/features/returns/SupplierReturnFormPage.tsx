import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { RETURN_REASONS, RETURN_REASON_LABELS, type ReturnReason } from '@stockflow/shared';
import { BackLink } from '@/components/BackLink';
import { FormField, fieldA11y } from '@/components/FormField';
import { FormAlert } from '@/components/form-parts';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useWarehouseOptions } from '@/features/catalog/api';
import { usePartners } from '@/features/partners/api';
import { usePurchaseOrders } from '@/features/purchasing/api';
import { useAvailability } from '@/features/sales/api';
import {
  QuantityLinesEditor,
  newQuantityLine,
  validateQuantityLines,
  type QuantityLine,
} from '@/features/warehouse/components';
import { ApiError } from '@/lib/api-client';
import { useCreateSupplierReturn } from './api';

const NONE = 'none';

export function SupplierReturnFormPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const suppliers = usePartners('suppliers', { pageSize: 100, sort: 'name' });
  const warehouses = useWarehouseOptions();
  const create = useCreateSupplierReturn();
  const [supplierId, setSupplierId] = useState(params.get('supplierId') ?? '');
  const [warehouseId, setWarehouseId] = useState(params.get('warehouseId') ?? '');
  const [purchaseOrderId, setPurchaseOrderId] = useState(NONE);
  const [reason, setReason] = useState<ReturnReason | ''>('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<QuantityLine[]>(() => [
    newQuantityLine({
      productId: params.get('productId') ?? '',
      quantity: params.get('quantity') ?? '',
      source: 'quarantine',
    }),
  ]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const orders = usePurchaseOrders(
    { supplierId, pageSize: 50, sort: '-orderDate' },
    Boolean(supplierId),
  );
  const availability = useAvailability(lines.map((l) => l.productId));

  const submit = async () => {
    setFormError(null);
    const issues = validateQuantityLines(lines, true);
    if (!supplierId) issues.supplierId = 'Select a supplier';
    if (!warehouseId) issues.warehouseId = 'Select a warehouse';
    if (!reason) issues.reason = 'Select a reason';
    if (reason === 'other' && !notes.trim()) issues.notes = 'Describe the reason';
    setErrors(issues);
    if (Object.keys(issues).length > 0) return;
    try {
      const ret = await create.mutateAsync({
        supplierId,
        warehouseId,
        purchaseOrderId: purchaseOrderId === NONE ? null : purchaseOrderId,
        reason: reason as ReturnReason,
        notes,
        lines: lines.map((l) => ({
          productId: l.productId,
          quantity: Number(l.quantity),
          source: l.source,
        })),
      });
      toast.success(`${ret.number} raised for approval`);
      void navigate(`/supplier-returns/${ret.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.details.length > 0) {
        setErrors(Object.fromEntries(error.details.map((d) => [d.path, d.message])));
      }
      setFormError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    }
  };

  return (
    <>
      <BackLink to="/supplier-returns" label="Supplier returns" />
      <PageHeader
        title="New supplier return"
        description="Approval is needed before goods are sent back. Stock leaves the warehouse only when the return is sent."
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
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FormField id="srn-supplier" label="Supplier" error={errors.supplierId}>
              <Select
                value={supplierId}
                onValueChange={(v) => {
                  setSupplierId(v);
                  setPurchaseOrderId(NONE);
                }}
              >
                <SelectTrigger {...fieldA11y('srn-supplier', errors.supplierId)} className="w-full">
                  <SelectValue placeholder="Select a supplier" />
                </SelectTrigger>
                <SelectContent>
                  {(suppliers.data?.data ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField id="srn-warehouse" label="From warehouse" error={errors.warehouseId}>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger
                  {...fieldA11y('srn-warehouse', errors.warehouseId)}
                  className="w-full"
                >
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
            <FormField id="srn-po" label="Purchase order" error={errors.purchaseOrderId}>
              <Select
                value={purchaseOrderId}
                onValueChange={setPurchaseOrderId}
                disabled={!supplierId}
              >
                <SelectTrigger {...fieldA11y('srn-po', errors.purchaseOrderId)} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not linked</SelectItem>
                  {(orders.data?.data ?? []).map((po) => (
                    <SelectItem key={po.id} value={po.id}>
                      {po.number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField id="srn-reason" label="Reason" error={errors.reason}>
              <Select value={reason} onValueChange={(v) => setReason(v as ReturnReason)}>
                <SelectTrigger {...fieldA11y('srn-reason', errors.reason)} className="w-full">
                  <SelectValue placeholder="Select a reason" />
                </SelectTrigger>
                <SelectContent>
                  {RETURN_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {RETURN_REASON_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <div className="sm:col-span-2 lg:col-span-4">
              <FormField id="srn-notes" label="Notes" error={errors.notes}>
                <Textarea
                  {...fieldA11y('srn-notes', errors.notes)}
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
          warehouseId={warehouseId}
          availability={availability.data}
          stockColumn="bySource"
          withSource
        />
        <div>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? <Loader2 className="animate-spin" /> : null}
            Raise return
          </Button>
        </div>
      </form>
    </>
  );
}
