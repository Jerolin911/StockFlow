import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { minorToDecimal, parseMoney, type PurchaseOrderDto } from '@stockflow/shared';
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
import { usePartners } from '@/features/partners/api';
import { ApiError } from '@/lib/api-client';
import {
  usePurchaseOrder,
  usePurchaseOrderAction,
  useSavePurchaseOrder,
  useSupplierPrices,
} from './api';
import {
  LinesEditor,
  newEditorLine,
  validateLines,
  type EditorLine,
  type LineErrors,
} from './LinesEditor';

export function PurchaseOrderFormPage() {
  const { id } = useParams<{ id: string }>();
  const existing = usePurchaseOrder(id);
  if (id && !existing.data) {
    return existing.isError ? (
      <p className="text-destructive text-sm">Couldn't load this purchase order.</p>
    ) : (
      <Skeleton className="h-64 w-full" />
    );
  }
  if (existing.data && existing.data.status !== 'draft') {
    return (
      <p className="text-muted-foreground text-sm">Only draft purchase orders can be edited.</p>
    );
  }
  return <OrderForm key={id ?? 'new'} order={existing.data ?? null} />;
}

function OrderForm({ order }: { order: PurchaseOrderDto | null }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const warehouses = useWarehouseOptions();
  const suppliers = usePartners('suppliers', { status: 'active', pageSize: 100 });
  const save = useSavePurchaseOrder();
  const action = usePurchaseOrderAction();

  const [supplierId, setSupplierId] = useState(
    order?.supplier.id ?? params.get('supplierId') ?? '',
  );
  const [warehouseId, setWarehouseId] = useState(
    order?.warehouse.id ?? params.get('warehouseId') ?? '',
  );
  const [expectedDate, setExpectedDate] = useState(order?.expectedDate ?? '');
  const [notes, setNotes] = useState(order?.notes ?? '');
  const [lines, setLines] = useState<EditorLine[]>(() =>
    order
      ? order.lines.map((l) =>
          newEditorLine({
            productId: l.productId,
            quantity: String(l.quantity),
            unitCost: minorToDecimal(l.unitCost),
          }),
        )
      : [
          newEditorLine({
            productId: params.get('productId') ?? '',
            quantity: params.get('quantity') ?? '',
          }),
        ],
  );
  const [errors, setErrors] = useState<LineErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState<'draft' | 'submit' | null>(null);

  const prices = useSupplierPrices(supplierId || undefined);
  const priceMap = useMemo(
    () => new Map((prices.data ?? []).map((p) => [p.product.id, p.unitCost])),
    [prices.data],
  );
  const supplier = suppliers.data?.data.find((s) => s.id === supplierId);

  const submit = async (andSubmit: boolean) => {
    setFormError(null);
    const issues = validateLines(lines, 'order');
    if (!supplierId) issues.supplierId = 'Select a supplier';
    if (!warehouseId) issues.warehouseId = 'Select a warehouse';
    setErrors(issues);
    if (Object.keys(issues).length > 0) return;

    setPending(andSubmit ? 'submit' : 'draft');
    try {
      const saved = await save.mutateAsync({
        ...(order ? { id: order.id } : {}),
        supplierId,
        warehouseId,
        expectedDate: expectedDate || null,
        notes,
        lines: lines.map((l) => ({
          productId: l.productId,
          quantity: Number(l.quantity),
          ...(l.unitCost.trim() ? { unitCost: parseMoney(l.unitCost)! } : {}),
        })),
      });
      if (andSubmit) await action.mutateAsync({ id: saved.id, action: 'submit' });
      toast.success(
        andSubmit ? `${saved.number} submitted for approval` : `${saved.number} saved as draft`,
      );
      void navigate(`/purchase-orders/${saved.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.details.length > 0) {
        setErrors(Object.fromEntries(error.details.map((d) => [d.path, d.message])));
      }
      setFormError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <BackLink
        to={order ? `/purchase-orders/${order.id}` : '/purchase-orders'}
        label={order ? order.number : 'Purchase orders'}
      />
      <PageHeader title={order ? `Edit ${order.number}` : 'New purchase order'} />
      <form
        noValidate
        className="grid gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(true);
        }}
      >
        <FormAlert message={formError} />
        <Card>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FormField
              id="po-supplier"
              label="Supplier"
              error={errors.supplierId}
              {...(supplier?.leadTimeDays != null && !expectedDate
                ? { hint: `Expected date defaults to ${supplier.leadTimeDays} days from today.` }
                : {})}
            >
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger {...fieldA11y('po-supplier', errors.supplierId)} className="w-full">
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
            <FormField id="po-warehouse" label="Deliver to" error={errors.warehouseId}>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger
                  {...fieldA11y('po-warehouse', errors.warehouseId)}
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
            <FormField id="po-expected" label="Expected delivery" error={errors.expectedDate}>
              <Input
                {...fieldA11y('po-expected', errors.expectedDate)}
                type="date"
                value={expectedDate}
                onChange={(event) => setExpectedDate(event.target.value)}
              />
            </FormField>
            <div className="sm:col-span-2 lg:col-span-3">
              <FormField id="po-notes" label="Notes for the supplier" error={errors.notes}>
                <Textarea
                  {...fieldA11y('po-notes', errors.notes)}
                  rows={2}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </FormField>
            </div>
          </CardContent>
        </Card>

        <LinesEditor
          mode="order"
          lines={lines}
          onChange={setLines}
          errors={errors}
          supplierPrices={priceMap}
        />

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending !== null}>
            {pending === 'submit' ? <Loader2 className="animate-spin" /> : null}
            Submit for approval
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending !== null}
            onClick={() => void submit(false)}
          >
            {pending === 'draft' ? <Loader2 className="animate-spin" /> : null}
            Save as draft
          </Button>
        </div>
      </form>
    </>
  );
}
