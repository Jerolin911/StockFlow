import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  RETURN_REASONS,
  RETURN_REASON_LABELS,
  type ReturnReason,
  type SalesOrderDto,
} from '@stockflow/shared';
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
import { useWarehouseOptions } from '@/features/catalog/api';
import { useSalesOrder, useSalesOrders } from '@/features/sales/api';
import { ApiError } from '@/lib/api-client';
import { useCreateCustomerReturn } from './api';

const returnable = (l: SalesOrderDto['lines'][number]) => l.shippedQuantity - l.returnedQuantity;

export function CustomerReturnFormPage() {
  const [params, setParams] = useSearchParams();
  const salesOrderId = params.get('salesOrderId') ?? '';
  const order = useSalesOrder(salesOrderId || undefined);
  const shipped = useSalesOrders({ returnable: 'true', pageSize: 100 }, !salesOrderId);
  const candidates = shipped.data?.data ?? [];

  return (
    <>
      <BackLink to="/customer-returns" label="Customer returns" />
      <PageHeader
        title="New customer return"
        description="Returns are raised against shipped quantities and need approval before goods are received."
      />
      {!salesOrderId ? (
        <Card className="max-w-xl">
          <CardContent>
            <FormField id="rma-so" label="Sales order">
              <Select onValueChange={(id) => setParams({ salesOrderId: id })}>
                <SelectTrigger id="rma-so" className="w-full">
                  <SelectValue
                    placeholder={shipped.isPending ? 'Loading…' : 'Select a shipped order'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {candidates.map((so) => (
                    <SelectItem key={so.id} value={so.id}>
                      {so.number} — {so.customer.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            {shipped.data && candidates.length === 0 ? (
              <p className="text-muted-foreground mt-3 text-sm">
                No shipped orders have units left to return.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : order.data ? (
        order.data.lines.some((l) => returnable(l) > 0) ? (
          <ReturnForm key={order.data.id} order={order.data} />
        ) : (
          <p className="text-muted-foreground text-sm">
            {order.data.number} has no shipped units left to return.{' '}
            <Link to={`/sales-orders/${order.data.id}`} className="underline">
              View the order
            </Link>
          </p>
        )
      ) : order.isError ? (
        <p className="text-destructive text-sm">Couldn't load the sales order.</p>
      ) : (
        <Skeleton className="h-64 w-full" />
      )}
    </>
  );
}

const WHOLE = /^\d{1,9}$/;
const num = (v: string) => (WHOLE.test(v.trim()) ? Number(v) : 0);

function ReturnForm({ order }: { order: SalesOrderDto }) {
  const navigate = useNavigate();
  const create = useCreateCustomerReturn();
  const warehouses = useWarehouseOptions();
  const lines = order.lines.filter((l) => returnable(l) > 0);
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, ''])),
  );
  const [reason, setReason] = useState<ReturnReason | ''>('');
  const [warehouseId, setWarehouseId] = useState(order.warehouse.id);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const total = lines.reduce((s, l) => s + num(quantities[l.id]!), 0);

  const submit = async () => {
    setFormError(null);
    const issues: Record<string, string> = {};
    lines.forEach((l, index) => {
      const v = quantities[l.id]!.trim();
      if (v !== '' && !WHOLE.test(v)) issues[`lines.${index}.quantity`] = 'Whole number';
      else if (num(v) > returnable(l))
        issues[`lines.${index}.quantity`] = `At most ${returnable(l)}`;
    });
    if (total === 0) issues.lines = 'Enter a quantity for at least one product';
    if (!reason) issues.reason = 'Select a reason';
    if (reason === 'other' && !notes.trim()) issues.notes = 'Describe the reason';
    setErrors(issues);
    if (Object.keys(issues).length > 0) return;
    try {
      const ret = await create.mutateAsync({
        salesOrderId: order.id,
        warehouseId,
        reason: reason as ReturnReason,
        notes,
        lines: lines.map((l) => ({ soLineId: l.id, quantity: num(quantities[l.id]!) })),
      });
      toast.success(`${ret.number} raised for approval`);
      void navigate(`/customer-returns/${ret.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.details.length > 0) {
        setErrors(Object.fromEntries(error.details.map((d) => [d.path, d.message])));
      }
      setFormError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
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
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="text-sm">
            <p className="text-muted-foreground">Sales order</p>
            <Link
              to={`/sales-orders/${order.id}`}
              className="mt-1 block font-mono font-medium hover:underline"
            >
              {order.number}
            </Link>
            <p className="text-muted-foreground mt-1 text-xs">{order.customer.name}</p>
          </div>
          <FormField id="rma-reason" label="Reason" error={errors.reason}>
            <Select value={reason} onValueChange={(v) => setReason(v as ReturnReason)}>
              <SelectTrigger {...fieldA11y('rma-reason', errors.reason)} className="w-full">
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
          <FormField id="rma-warehouse" label="Return to" error={errors.warehouseId}>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger {...fieldA11y('rma-warehouse', errors.warehouseId)} className="w-full">
                <SelectValue />
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
          <div className="sm:col-span-2 lg:col-span-3">
            <FormField id="rma-notes" label="Notes" error={errors.notes}>
              <Textarea
                {...fieldA11y('rma-notes', errors.notes)}
                rows={2}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </FormField>
          </div>
        </CardContent>
      </Card>
      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Product</TableHead>
              <TableHead className="text-right">Shipped</TableHead>
              <TableHead className="text-right">Already returned</TableHead>
              <TableHead className="w-32 pr-4">Return</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l, index) => {
              const error = errors[`lines.${index}.quantity`];
              return (
                <TableRow key={l.id} className="align-top">
                  <TableCell className="pl-4">
                    <div className="font-medium">{l.name}</div>
                    <div className="text-muted-foreground font-mono text-xs">
                      {l.sku} · {l.unit}
                    </div>
                  </TableCell>
                  <TableCell className="pt-4 text-right tabular-nums">
                    {l.shippedQuantity}
                  </TableCell>
                  <TableCell className="pt-4 text-right tabular-nums">
                    {l.returnedQuantity}
                  </TableCell>
                  <TableCell className="pr-4">
                    <Input
                      aria-label={`Quantity to return for ${l.sku}`}
                      aria-invalid={error ? true : undefined}
                      inputMode="numeric"
                      placeholder={`Up to ${returnable(l)}`}
                      value={quantities[l.id]}
                      onChange={(event) =>
                        setQuantities((current) => ({ ...current, [l.id]: event.target.value }))
                      }
                    />
                    {error ? <p className="text-destructive mt-1 text-xs">{error}</p> : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
          {errors.lines ? (
            <span className="text-destructive text-xs">{errors.lines}</span>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">{total} units to return</span>
        </div>
      </Card>
      <div className="flex gap-2">
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? <Loader2 className="animate-spin" /> : null}
          Raise return
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link to={`/sales-orders/${order.id}`}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
