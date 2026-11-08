import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { PurchaseOrderDto } from '@stockflow/shared';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import { usePostGoodsReceipt, usePurchaseOrder, usePurchaseOrders } from './api';

export function GoodsReceiptFormPage() {
  const [params, setParams] = useSearchParams();
  const purchaseOrderId = params.get('purchaseOrderId') ?? '';
  const order = usePurchaseOrder(purchaseOrderId || undefined);
  const openOrders = usePurchaseOrders(
    { open: 'true', pageSize: 100, sort: 'expectedDate' },
    !purchaseOrderId,
  );

  return (
    <>
      <BackLink to="/goods-receipts" label="Goods receipts" />
      <PageHeader
        title="Receive goods"
        description="Record what arrived. Only accepted quantities are added to stock; rejected and damaged quantities stay outstanding on the order."
      />
      {!purchaseOrderId ? (
        <Card className="max-w-xl">
          <CardContent>
            <FormField id="grn-po" label="Purchase order">
              <Select onValueChange={(id) => setParams({ purchaseOrderId: id })}>
                <SelectTrigger id="grn-po" className="w-full">
                  <SelectValue
                    placeholder={
                      openOrders.isPending ? 'Loading…' : 'Select an open purchase order'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {(openOrders.data?.data ?? []).map((po) => (
                    <SelectItem key={po.id} value={po.id}>
                      {po.number} — {po.supplier.name} ({po.warehouse.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            {openOrders.data && openOrders.data.data.length === 0 ? (
              <p className="text-muted-foreground mt-3 text-sm">
                No purchase orders are waiting for goods.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : order.data ? (
        order.data.status === 'approved' || order.data.status === 'partially_received' ? (
          <ReceiptForm key={order.data.id} order={order.data} />
        ) : (
          <p className="text-muted-foreground text-sm">
            {order.data.number} isn't waiting for goods.{' '}
            <Link to={`/purchase-orders/${order.data.id}`} className="underline">
              View the order
            </Link>
          </p>
        )
      ) : order.isError ? (
        <p className="text-destructive text-sm">Couldn't load the purchase order.</p>
      ) : (
        <Skeleton className="h-64 w-full" />
      )}
    </>
  );
}

interface LineState {
  accepted: string;
  rejected: string;
  damaged: string;
  reason: string;
}

const WHOLE = /^\d{1,9}$/;
const num = (value: string) => (WHOLE.test(value.trim()) ? Number(value) : 0);
const today = () => new Date().toISOString().slice(0, 10);

function ReceiptForm({ order }: { order: PurchaseOrderDto }) {
  const navigate = useNavigate();
  const post = usePostGoodsReceipt();
  const openLines = order.lines.filter((l) => l.pendingQuantity > 0);
  const [receivedAt, setReceivedAt] = useState(today());
  const [deliveryNote, setDeliveryNote] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Record<string, LineState>>(() =>
    Object.fromEntries(
      openLines.map((l) => [l.id, { accepted: '', rejected: '', damaged: '', reason: '' }]),
    ),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const update = (id: string, changes: Partial<LineState>) =>
    setLines((current) => ({ ...current, [id]: { ...current[id]!, ...changes } }));

  const acceptedTotal = openLines.reduce((s, l) => s + num(lines[l.id]!.accepted), 0);

  const submit = async () => {
    setFormError(null);
    const issues: Record<string, string> = {};
    let any = false;
    openLines.forEach((l, index) => {
      const state = lines[l.id]!;
      for (const field of ['accepted', 'rejected', 'damaged'] as const) {
        if (state[field].trim() !== '' && !WHOLE.test(state[field].trim())) {
          issues[`lines.${index}.${field}Quantity`] = 'Whole number';
        }
      }
      const accepted = num(state.accepted);
      if (accepted > l.pendingQuantity) {
        issues[`lines.${index}.acceptedQuantity`] = `Only ${l.pendingQuantity} outstanding`;
      }
      if (num(state.rejected) + num(state.damaged) > 0 && !state.reason.trim()) {
        issues[`lines.${index}.rejectionReason`] = 'Say why';
      }
      if (accepted + num(state.rejected) + num(state.damaged) > 0) any = true;
    });
    if (!any) issues.lines = 'Enter what arrived for at least one product';
    setErrors(issues);
    if (Object.keys(issues).length > 0) return;

    setPending(true);
    try {
      const grn = await post.mutateAsync({
        purchaseOrderId: order.id,
        receivedAt,
        deliveryNote,
        notes,
        lines: openLines.map((l) => ({
          poLineId: l.id,
          acceptedQuantity: num(lines[l.id]!.accepted),
          rejectedQuantity: num(lines[l.id]!.rejected),
          damagedQuantity: num(lines[l.id]!.damaged),
          rejectionReason: lines[l.id]!.reason.trim(),
        })),
      });
      toast.success(`${grn.number} posted: ${grn.totals.accepted} units added to stock`);
      void navigate(`/goods-receipts/${grn.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.details.length > 0) {
        setErrors(Object.fromEntries(error.details.map((d) => [d.path, d.message])));
      }
      setFormError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    } finally {
      setPending(false);
    }
  };

  return (
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
          <div className="text-sm">
            <p className="text-muted-foreground">Purchase order</p>
            <Link
              to={`/purchase-orders/${order.id}`}
              className="mt-1 block font-mono font-medium hover:underline"
            >
              {order.number}
            </Link>
            <p className="text-muted-foreground mt-1 text-xs">
              {order.supplier.name} · {order.warehouse.code} · expected{' '}
              {formatDate(order.expectedDate)}
            </p>
          </div>
          <FormField id="grn-date" label="Received on" error={errors.receivedAt}>
            <Input
              {...fieldA11y('grn-date', errors.receivedAt)}
              type="date"
              max={today()}
              value={receivedAt}
              onChange={(event) => setReceivedAt(event.target.value)}
            />
          </FormField>
          <FormField id="grn-note" label="Supplier delivery note" error={errors.deliveryNote}>
            <Input
              {...fieldA11y('grn-note', errors.deliveryNote)}
              value={deliveryNote}
              onChange={(event) => setDeliveryNote(event.target.value)}
            />
          </FormField>
          <FormField id="grn-notes" label="Notes" error={errors.notes}>
            <Textarea
              {...fieldA11y('grn-notes', errors.notes)}
              rows={1}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </FormField>
        </CardContent>
      </Card>

      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Product</TableHead>
              <TableHead className="text-right">Ordered</TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
              <TableHead className="w-28">Accepted</TableHead>
              <TableHead className="w-28">Rejected</TableHead>
              <TableHead className="w-28">Damaged</TableHead>
              <TableHead className="min-w-48 pr-4">Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {openLines.map((l, index) => {
              const state = lines[l.id]!;
              const needsReason = num(state.rejected) + num(state.damaged) > 0;
              const cell = (field: 'accepted' | 'rejected' | 'damaged', label: string) => {
                const error = errors[`lines.${index}.${field}Quantity`];
                return (
                  <TableCell>
                    <Input
                      aria-label={`${label} for ${l.sku}`}
                      aria-invalid={error ? true : undefined}
                      inputMode="numeric"
                      value={state[field]}
                      onChange={(event) => update(l.id, { [field]: event.target.value })}
                    />
                    {error ? <p className="text-destructive mt-1 text-xs">{error}</p> : null}
                  </TableCell>
                );
              };
              return (
                <TableRow key={l.id} className="align-top">
                  <TableCell className="pl-4">
                    <div className="font-medium">{l.name}</div>
                    <div className="text-muted-foreground font-mono text-xs">
                      {l.sku} · {l.unit}
                    </div>
                  </TableCell>
                  <TableCell className="pt-4 text-right tabular-nums">{l.quantity}</TableCell>
                  <TableCell className="pt-4 text-right tabular-nums">
                    {l.receivedQuantity}
                  </TableCell>
                  <TableCell className="pt-4 text-right font-medium tabular-nums">
                    <button
                      type="button"
                      className="hover:underline"
                      onClick={() => update(l.id, { accepted: String(l.pendingQuantity) })}
                      aria-label={`Accept all ${l.pendingQuantity} outstanding ${l.sku}`}
                    >
                      {l.pendingQuantity}
                    </button>
                  </TableCell>
                  {cell('accepted', 'Accepted')}
                  {cell('rejected', 'Rejected')}
                  {cell('damaged', 'Damaged')}
                  <TableCell className="pr-4">
                    <Input
                      aria-label={`Reason for ${l.sku}`}
                      aria-invalid={errors[`lines.${index}.rejectionReason`] ? true : undefined}
                      disabled={!needsReason}
                      placeholder={needsReason ? 'e.g. crushed cartons' : undefined}
                      value={state.reason}
                      onChange={(event) => update(l.id, { reason: event.target.value })}
                    />
                    {errors[`lines.${index}.rejectionReason`] ? (
                      <p className="text-destructive mt-1 text-xs">
                        {errors[`lines.${index}.rejectionReason`]}
                      </p>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setLines((current) =>
                  Object.fromEntries(
                    openLines.map((l) => [
                      l.id,
                      { ...current[l.id]!, accepted: String(l.pendingQuantity) },
                    ]),
                  ),
                )
              }
            >
              Accept all outstanding
            </Button>
            {errors.lines ? <span className="text-destructive text-xs">{errors.lines}</span> : null}
          </div>
          <span className="text-muted-foreground">
            {acceptedTotal} units will be added to {order.warehouse.name}
          </span>
        </div>
      </Card>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Post goods receipt
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link to={`/purchase-orders/${order.id}`}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
