import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { SalesOrderDto } from '@stockflow/shared';
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
import { useCreateShipment, useSalesOrder, useSalesOrders } from './api';

export function ShipmentFormPage() {
  const [params, setParams] = useSearchParams();
  const salesOrderId = params.get('salesOrderId') ?? '';
  const order = useSalesOrder(salesOrderId || undefined);
  const waiting = useSalesOrders(
    { toFulfil: 'true', pageSize: 100, sort: 'requiredDate' },
    !salesOrderId,
  );

  return (
    <>
      <BackLink to="/shipments" label="Shipments" />
      <PageHeader
        title="Create pick list"
        description="Choose what to pick for this shipment. Stock stays reserved for the order and leaves the warehouse only when the shipment is dispatched."
      />
      {!salesOrderId ? (
        <Card className="max-w-xl">
          <CardContent>
            <FormField id="shp-so" label="Sales order">
              <Select onValueChange={(id) => setParams({ salesOrderId: id })}>
                <SelectTrigger id="shp-so" className="w-full">
                  <SelectValue
                    placeholder={waiting.isPending ? 'Loading…' : 'Select an order to fulfil'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(waiting.data?.data ?? []).map((so) => (
                    <SelectItem key={so.id} value={so.id}>
                      {so.number} — {so.customer.name} ({so.warehouse.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            {waiting.data && waiting.data.data.length === 0 ? (
              <p className="text-muted-foreground mt-3 text-sm">
                Every confirmed order is already on a pick list.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : order.data ? (
        order.data.lines.some((l) => l.unallocatedQuantity > 0) ? (
          <PickListForm key={order.data.id} order={order.data} />
        ) : (
          <p className="text-muted-foreground text-sm">
            {order.data.number} has nothing left to put on a pick list.{' '}
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
const num = (value: string) => (WHOLE.test(value.trim()) ? Number(value) : 0);

function PickListForm({ order }: { order: SalesOrderDto }) {
  const navigate = useNavigate();
  const create = useCreateShipment();
  const openLines = order.lines.filter((l) => l.unallocatedQuantity > 0);
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(openLines.map((l) => [l.id, String(l.unallocatedQuantity)])),
  );
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const total = openLines.reduce((s, l) => s + num(quantities[l.id]!), 0);

  const submit = async () => {
    setFormError(null);
    const issues: Record<string, string> = {};
    openLines.forEach((l, index) => {
      const value = quantities[l.id]!.trim();
      if (value !== '' && !WHOLE.test(value)) issues[`lines.${index}.quantity`] = 'Whole number';
      else if (num(value) > l.unallocatedQuantity) {
        issues[`lines.${index}.quantity`] = `At most ${l.unallocatedQuantity}`;
      }
    });
    if (total === 0) issues.lines = 'Enter a quantity for at least one product';
    setErrors(issues);
    if (Object.keys(issues).length > 0) return;

    setPending(true);
    try {
      const shipment = await create.mutateAsync({
        salesOrderId: order.id,
        notes,
        lines: openLines.map((l) => ({ soLineId: l.id, quantity: num(quantities[l.id]!) })),
      });
      toast.success(`${shipment.number} created: ${total} units to pick`);
      void navigate(`/shipments/${shipment.id}`);
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
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="text-sm">
            <p className="text-muted-foreground">Sales order</p>
            <Link
              to={`/sales-orders/${order.id}`}
              className="mt-1 block font-mono font-medium hover:underline"
            >
              {order.number}
            </Link>
            <p className="text-muted-foreground mt-1 text-xs">
              {order.customer.name} · from {order.warehouse.code} · required{' '}
              {formatDate(order.requiredDate)}
            </p>
          </div>
          <div className="text-sm">
            <p className="text-muted-foreground">Ship to</p>
            <p className="mt-1 font-medium whitespace-pre-line">{order.shippingAddress || '—'}</p>
          </div>
          <FormField id="shp-notes" label="Notes for the picker" error={errors.notes}>
            <Textarea
              {...fieldA11y('shp-notes', errors.notes)}
              rows={2}
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
              <TableHead className="text-right">Shipped or on pick lists</TableHead>
              <TableHead className="text-right">Left to ship</TableHead>
              <TableHead className="w-32 pr-4">Pick now</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {openLines.map((l, index) => {
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
                    {l.quantity - l.cancelledQuantity}
                  </TableCell>
                  <TableCell className="pt-4 text-right tabular-nums">
                    {l.shippedQuantity + l.allocatedQuantity}
                  </TableCell>
                  <TableCell className="pt-4 text-right font-medium tabular-nums">
                    {l.unallocatedQuantity}
                  </TableCell>
                  <TableCell className="pr-4">
                    <Input
                      aria-label={`Quantity to pick for ${l.sku}`}
                      aria-invalid={error ? true : undefined}
                      inputMode="numeric"
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
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm">
          {errors.lines ? (
            <span className="text-destructive text-xs">{errors.lines}</span>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">{total} units to pick</span>
        </div>
      </Card>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Create pick list
        </Button>
        <Button type="button" variant="outline" asChild>
          <Link to={`/sales-orders/${order.id}`}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
