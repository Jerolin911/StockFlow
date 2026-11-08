import { useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  salesDocumentTotals,
  salesLineAmounts,
  type ProductDto,
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
import { Textarea } from '@/components/ui/textarea';
import { useWarehouseOptions } from '@/features/catalog/api';
import { usePartners } from '@/features/partners/api';
import { useMoney } from '@/features/settings/api';
import { ApiError, apiRequest } from '@/lib/api-client';
import { useAvailability, useSalesOrder, useSalesOrderAction, useSaveSalesOrder } from './api';
import {
  SalesLinesEditor,
  newSalesLine,
  salesLineFromOrder,
  toSalesLineInput,
  validateSalesLines,
  type LineErrors,
  type SalesLine,
} from './SalesLinesEditor';

export function SalesOrderFormPage() {
  const { id } = useParams<{ id: string }>();
  const existing = useSalesOrder(id);
  if (id && !existing.data) {
    return existing.isError ? (
      <p className="text-destructive text-sm">Couldn't load this sales order.</p>
    ) : (
      <Skeleton className="h-64 w-full" />
    );
  }
  if (existing.data && existing.data.status !== 'draft') {
    return <p className="text-muted-foreground text-sm">Only draft sales orders can be edited.</p>;
  }
  return <OrderForm key={id ?? 'new'} order={existing.data ?? null} />;
}

function OrderForm({ order }: { order: SalesOrderDto | null }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const warehouses = useWarehouseOptions();
  const customers = usePartners('customers', { status: 'active', pageSize: 100, sort: 'name' });
  const save = useSaveSalesOrder();
  const action = useSalesOrderAction();

  const [customerId, setCustomerId] = useState(
    order?.customer.id ?? params.get('customerId') ?? '',
  );
  const [warehouseId, setWarehouseId] = useState(order?.warehouse.id ?? '');
  const [requiredDate, setRequiredDate] = useState(order?.requiredDate ?? '');
  // null means "use the customer's address"; set once the user types.
  const [shippingAddress, setShippingAddress] = useState<string | null>(
    order ? order.shippingAddress : null,
  );
  const [customerReference, setCustomerReference] = useState(order?.customerReference ?? '');
  const [notes, setNotes] = useState(order?.notes ?? '');
  const [lines, setLines] = useState<SalesLine[]>(() =>
    order
      ? order.lines.map(salesLineFromOrder)
      : [newSalesLine({ productId: params.get('productId') ?? '' })],
  );
  const [errors, setErrors] = useState<LineErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState<'draft' | 'confirm' | null>(null);

  const availability = useAvailability(lines.map((l) => l.productId));
  const customer = customers.data?.data.find((c) => c.id === customerId);
  const defaultAddress = customer ? customer.shippingAddress || customer.address : '';

  const submit = async (andConfirm: boolean) => {
    setFormError(null);
    const issues = validateSalesLines(lines);
    if (!customerId) issues.customerId = 'Select a customer';
    if (!warehouseId) issues.warehouseId = 'Select a warehouse';
    setErrors(issues);
    if (Object.keys(issues).length > 0) return;

    setPending(andConfirm ? 'confirm' : 'draft');
    let saved: SalesOrderDto | null = null;
    try {
      saved = await save.mutateAsync({
        ...(order ? { id: order.id } : {}),
        customerId,
        warehouseId,
        requiredDate: requiredDate || null,
        shippingAddress: shippingAddress ?? defaultAddress,
        customerReference,
        notes,
        lines: lines.map(toSalesLineInput),
      });
      if (andConfirm) {
        await action.mutateAsync({ id: saved.id, action: 'confirm' });
        toast.success(`${saved.number} confirmed and stock reserved`);
      } else {
        toast.success(`${saved.number} saved as draft`);
      }
      void navigate(`/sales-orders/${saved.id}`);
    } catch (error) {
      if (saved) {
        // Saved, but confirmation failed (usually stock): show the draft with the reason.
        toast.error(
          `${saved.number} saved as draft. ${error instanceof ApiError ? error.message : ''}`,
        );
        void navigate(`/sales-orders/${saved.id}`);
        return;
      }
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
        to={order ? `/sales-orders/${order.id}` : '/sales-orders'}
        label={order ? order.number : 'Sales orders'}
      />
      <PageHeader
        title={order ? `Edit ${order.number}` : 'New sales order'}
        description="Confirming reserves stock in the chosen warehouse. Orders can only be confirmed when every line is available."
      />
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
            <FormField id="so-customer" label="Customer" error={errors.customerId}>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger {...fieldA11y('so-customer', errors.customerId)} className="w-full">
                  <SelectValue placeholder="Select a customer" />
                </SelectTrigger>
                <SelectContent>
                  {(customers.data?.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField id="so-warehouse" label="Ship from" error={errors.warehouseId}>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger
                  {...fieldA11y('so-warehouse', errors.warehouseId)}
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
            <FormField id="so-required" label="Required by" error={errors.requiredDate}>
              <Input
                {...fieldA11y('so-required', errors.requiredDate)}
                type="date"
                value={requiredDate}
                onChange={(event) => setRequiredDate(event.target.value)}
              />
            </FormField>
            <div className="sm:col-span-2">
              <FormField
                id="so-address"
                label="Shipping address"
                error={errors.shippingAddress}
                {...(shippingAddress === null && customer
                  ? { hint: "From the customer's record" }
                  : {})}
              >
                <Textarea
                  {...fieldA11y('so-address', errors.shippingAddress)}
                  rows={2}
                  value={shippingAddress ?? defaultAddress}
                  onChange={(event) => setShippingAddress(event.target.value)}
                />
              </FormField>
            </div>
            <FormField
              id="so-reference"
              label="Customer reference"
              error={errors.customerReference}
              hint="Their PO or order number"
            >
              <Input
                {...fieldA11y('so-reference', errors.customerReference)}
                value={customerReference}
                maxLength={60}
                onChange={(event) => setCustomerReference(event.target.value)}
              />
            </FormField>
            <div className="sm:col-span-2 lg:col-span-3">
              <FormField id="so-notes" label="Notes" error={errors.notes}>
                <Textarea
                  {...fieldA11y('so-notes', errors.notes)}
                  rows={2}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </FormField>
            </div>
          </CardContent>
        </Card>

        <SalesLinesEditor
          lines={lines}
          onChange={setLines}
          errors={errors}
          warehouseId={warehouseId}
          availability={availability.data}
        />

        <OrderTotals lines={lines} />

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending !== null}>
            {pending === 'confirm' ? <Loader2 className="animate-spin" /> : null}
            Confirm and reserve stock
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

/** Order totals as they'll be saved: entered prices, else each product's selling price. */
function OrderTotals({ lines }: { lines: SalesLine[] }) {
  const money = useMoney();
  const products = useQueries({
    queries: lines.map((l) => ({
      queryKey: ['products', 'detail', l.productId],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        apiRequest<{ data: ProductDto }>(`/products/${l.productId}`, { signal }).then(
          (r) => r.data,
        ),
      enabled: Boolean(l.productId),
    })),
  });
  if (Object.keys(validateSalesLines(lines)).length > 0) return null;
  const amounts = lines.map((line, index) => {
    const product = products[index]?.data;
    if (!product) return null;
    const input = toSalesLineInput(line);
    return salesLineAmounts(
      input.quantity,
      input.unitPrice ?? product.sellingPrice,
      input.discountRate,
      product.taxRate,
    );
  });
  if (amounts.some((a) => a === null)) return null;
  const totals = salesDocumentTotals(amounts as NonNullable<(typeof amounts)[number]>[]);
  return (
    <Card className="w-full max-w-sm justify-self-end">
      <CardContent>
        <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Subtotal</dt>
          <dd className="text-right tabular-nums">{money(totals.grossTotal)}</dd>
          {totals.discountTotal > 0 ? (
            <>
              <dt className="text-muted-foreground">Discount</dt>
              <dd className="text-right tabular-nums">−{money(totals.discountTotal)}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">Tax</dt>
          <dd className="text-right tabular-nums">{money(totals.taxTotal)}</dd>
          <dt className="font-medium">Total</dt>
          <dd className="text-right font-medium tabular-nums">{money(totals.total)}</dd>
        </dl>
      </CardContent>
    </Card>
  );
}
