import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { MoreHorizontal, Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  minorToDecimal,
  parseMoney,
  type SupplierDto,
  type SupplierPriceDto,
} from '@stockflow/shared';
import { BackLink } from '@/components/BackLink';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FormField, fieldA11y } from '@/components/FormField';
import { DialogActions, FormAlert, FormDialog } from '@/components/form-parts';
import { PageHeader } from '@/components/PageHeader';
import { ActiveBadge, StatusBadge } from '@/components/StatusBadge';
import { NotFoundPage } from '@/components/StatusPages';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usePermission } from '@/features/auth/auth-context';
import { ProductPicker } from '@/features/catalog/ProductPicker';
import { useMoney } from '@/features/settings/api';
import { ApiError, apiRequest } from '@/lib/api-client';
import { formatDate, formatDateTime } from '@/lib/format';
import {
  useDeleteSupplierPrice,
  useGoodsReceipts,
  usePurchaseOrders,
  useSaveSupplierPrice,
  useSupplierDeliverySummary,
  useSupplierPrices,
} from './api';
import { PurchaseOrderStatusBadge } from './components';

export function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const supplier = useQuery({
    queryKey: ['suppliers', 'detail', id],
    queryFn: ({ signal }) =>
      apiRequest<{ data: SupplierDto }>(`/suppliers/${id}`, { signal }).then((r) => r.data),
    enabled: Boolean(id),
  });

  if (supplier.isError && supplier.error instanceof ApiError && supplier.error.status === 404) {
    return <NotFoundPage />;
  }
  if (!supplier.data) {
    return supplier.isError ? (
      <p className="text-destructive text-sm">Couldn't load this supplier.</p>
    ) : (
      <Skeleton className="h-64 w-full" />
    );
  }
  return <SupplierDetail supplier={supplier.data} />;
}

function SupplierDetail({ supplier: s }: { supplier: SupplierDto }) {
  const money = useMoney();
  const canWrite = usePermission('suppliers:write');
  const canOrder = usePermission('purchaseOrders:write');
  const summary = useSupplierDeliverySummary(s.id);
  const prices = useSupplierPrices(s.id);
  const orders = usePurchaseOrders({ supplierId: s.id, pageSize: 8 });
  const receipts = useGoodsReceipts({ supplierId: s.id, pageSize: 8 });
  const removePrice = useDeleteSupplierPrice();
  const [editing, setEditing] = useState<SupplierPriceDto | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<SupplierPriceDto | null>(null);

  const sum = summary.data;
  const measured = sum ? sum.onTime + sum.late : 0;
  const delivered = sum ? sum.acceptedUnits + sum.rejectedUnits + sum.damagedUnits : 0;

  return (
    <>
      <BackLink to="/suppliers" label="Suppliers" />
      <PageHeader
        title={s.name}
        description={
          <span className="flex items-center gap-2">
            <span className="font-mono">{s.code}</span>
            <ActiveBadge active={s.isActive} />
          </span>
        }
        actions={
          canOrder && s.isActive ? (
            <Button asChild>
              <Link to={`/purchase-orders/new?supplierId=${s.id}`}>
                <Plus />
                New purchase order
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Deliveries received" value={sum ? String(sum.receipts) : undefined} />
        <Stat
          label="On time"
          value={
            sum ? (measured > 0 ? `${Math.round((sum.onTime / measured) * 100)}%` : '—') : undefined
          }
          detail={
            sum && measured > 0 ? `${sum.onTime} of ${measured} with an expected date` : undefined
          }
        />
        <Stat
          label="Rejected or damaged"
          value={
            sum
              ? delivered > 0
                ? `${(((sum.rejectedUnits + sum.damagedUnits) / delivered) * 100).toFixed(1)}%`
                : '—'
              : undefined
          }
          detail={
            sum
              ? `${sum.rejectedUnits} rejected, ${sum.damagedUnits} damaged of ${delivered} units`
              : undefined
          }
        />
        <Stat
          label="Open orders"
          value={sum ? String(sum.openOrders) : undefined}
          detail={sum && sum.overdueOrders > 0 ? `${sum.overdueOrders} overdue` : undefined}
          alert={Boolean(sum && sum.overdueOrders > 0)}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="self-start">
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-sm">
              <Detail label="Contact">{s.contactName || '—'}</Detail>
              <Detail label="Email">
                {s.email ? (
                  <a href={`mailto:${s.email}`} className="hover:underline">
                    {s.email}
                  </a>
                ) : (
                  '—'
                )}
              </Detail>
              <Detail label="Phone">{s.phone || '—'}</Detail>
              <Detail label="Lead time">
                {s.leadTimeDays === null ? '—' : `${s.leadTimeDays} days`}
              </Detail>
              <Detail label="Address">{s.address || '—'}</Detail>
            </dl>
            {s.notes ? (
              <p className="text-muted-foreground mt-4 border-t pt-4 text-sm whitespace-pre-line">
                {s.notes}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="gap-0 overflow-hidden pb-0 lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <CardTitle>Price list</CardTitle>
            {canWrite ? (
              <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
                <Plus />
                Add price
              </Button>
            ) : null}
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Product</TableHead>
                <TableHead>Supplier SKU</TableHead>
                <TableHead className="text-right">Supplier price</TableHead>
                <TableHead className="text-right">Our cost price</TableHead>
                {canWrite ? <TableHead className="w-12 pr-6" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(prices.data ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground py-6 text-center text-sm">
                    {prices.isPending
                      ? 'Loading…'
                      : 'No prices yet. Orders use each product’s cost price.'}
                  </TableCell>
                </TableRow>
              ) : (
                prices.data!.map((p) => (
                  <TableRow key={p.product.id}>
                    <TableCell className="pl-6">
                      <Link
                        to={`/products/${p.product.id}`}
                        className="font-medium hover:underline"
                      >
                        {p.product.name}
                      </Link>
                      <div className="text-muted-foreground font-mono text-xs">{p.product.sku}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{p.supplierSku || '—'}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {money(p.unitCost)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right tabular-nums">
                      {money(p.product.costPrice)}
                    </TableCell>
                    {canWrite ? (
                      <TableCell className="pr-6">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Actions for ${p.product.sku}`}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setEditing(p)}>Edit</DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(p)}>
                              Remove
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="gap-0 overflow-hidden pb-0">
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <CardTitle>Purchase orders</CardTitle>
            <Button variant="link" size="sm" asChild className="h-auto p-0">
              <Link to={`/purchase-orders?supplierId=${s.id}`}>View all</Link>
            </Button>
          </CardHeader>
          <Table>
            <TableBody>
              {(orders.data?.data ?? []).length === 0 ? (
                <TableRow>
                  <TableCell className="text-muted-foreground py-6 text-center text-sm">
                    {orders.isPending ? 'Loading…' : 'No purchase orders yet.'}
                  </TableCell>
                </TableRow>
              ) : (
                orders.data!.data.map((po) => (
                  <TableRow key={po.id}>
                    <TableCell className="pl-6">
                      <Link
                        to={`/purchase-orders/${po.id}`}
                        className="font-mono text-xs font-medium hover:underline"
                      >
                        {po.number}
                      </Link>
                      <div className="text-muted-foreground text-xs">
                        Expected {formatDate(po.expectedDate)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        <PurchaseOrderStatusBadge status={po.status} />
                        {po.isOverdue ? <StatusBadge tone="red">Overdue</StatusBadge> : null}
                      </div>
                    </TableCell>
                    <TableCell className="pr-6 text-right tabular-nums">
                      {money(po.total)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
        <Card className="gap-0 overflow-hidden pb-0">
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <CardTitle>Delivery history</CardTitle>
            <Button variant="link" size="sm" asChild className="h-auto p-0">
              <Link to={`/goods-receipts?supplierId=${s.id}`}>View all</Link>
            </Button>
          </CardHeader>
          <Table>
            <TableBody>
              {(receipts.data?.data ?? []).length === 0 ? (
                <TableRow>
                  <TableCell className="text-muted-foreground py-6 text-center text-sm">
                    {receipts.isPending ? 'Loading…' : 'No deliveries yet.'}
                  </TableCell>
                </TableRow>
              ) : (
                receipts.data!.data.map((grn) => (
                  <TableRow key={grn.id}>
                    <TableCell className="pl-6">
                      <Link
                        to={`/goods-receipts/${grn.id}`}
                        className="font-mono text-xs font-medium hover:underline"
                      >
                        {grn.number}
                      </Link>
                      <div className="text-muted-foreground text-xs">
                        {formatDateTime(grn.receivedAt)}
                      </div>
                    </TableCell>
                    <TableCell>
                      {grn.onTime === null ? null : grn.onTime ? (
                        <StatusBadge tone="green">On time</StatusBadge>
                      ) : (
                        <StatusBadge tone="amber">Late</StatusBadge>
                      )}
                    </TableCell>
                    <TableCell className="pr-6 text-right text-sm tabular-nums">
                      {grn.totals.accepted} accepted
                      {grn.totals.rejected + grn.totals.damaged > 0 ? (
                        <div className="text-xs text-red-700">
                          {grn.totals.rejected + grn.totals.damaged} not accepted
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      <FormDialog
        open={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
        title={editing ? `Price for ${editing.product.sku}` : 'Add supplier price'}
      >
        <PriceForm
          supplierId={s.id}
          price={editing ?? null}
          existing={(prices.data ?? []).map((p) => p.product.id)}
          onDone={() => setEditing(undefined)}
        />
      </FormDialog>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Remove price"
        description={`Orders from ${s.name} will use the product cost for ${deleting?.product.sku ?? ''}.`}
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          await removePrice.mutateAsync({ supplierId: s.id, productId: deleting.product.id });
          toast.success('Price removed');
        }}
      />
    </>
  );
}

function PriceForm({
  supplierId,
  price,
  existing,
  onDone,
}: {
  supplierId: string;
  price: SupplierPriceDto | null;
  existing: string[];
  onDone: () => void;
}) {
  const save = useSaveSupplierPrice();
  const [productId, setProductId] = useState(price?.product.id ?? '');
  const [unitCost, setUnitCost] = useState(price ? minorToDecimal(price.unitCost) : '');
  const [supplierSku, setSupplierSku] = useState(price?.supplierSku ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    const issues: Record<string, string> = {};
    if (!productId) issues.productId = 'Select a product';
    if (parseMoney(unitCost) === null) issues.unitCost = 'Enter an amount such as 12.50';
    setErrors(issues);
    if (Object.keys(issues).length > 0) return;
    setPending(true);
    setFormError(null);
    try {
      await save.mutateAsync({
        supplierId,
        productId,
        unitCost: parseMoney(unitCost)!,
        supplierSku,
      });
      toast.success('Price saved');
      onDone();
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <form
        id="price-form"
        noValidate
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <FormAlert message={formError} />
        {price ? null : (
          <FormField id="price-product" label="Product" error={errors.productId}>
            <ProductPicker
              id="price-product"
              label="Product"
              value={productId}
              onChange={setProductId}
              excludeIds={existing}
              invalid={Boolean(errors.productId)}
            />
          </FormField>
        )}
        <FormField id="price-cost" label="Unit price" error={errors.unitCost}>
          <Input
            {...fieldA11y('price-cost', errors.unitCost)}
            inputMode="decimal"
            value={unitCost}
            onChange={(event) => setUnitCost(event.target.value)}
            autoFocus={price !== null}
          />
        </FormField>
        <FormField id="price-sku" label="Supplier's SKU">
          <Input
            id="price-sku"
            value={supplierSku}
            onChange={(event) => setSupplierSku(event.target.value)}
          />
        </FormField>
      </form>
      <DialogActions
        formId="price-form"
        submitLabel="Save price"
        pending={pending}
        onCancel={onDone}
      />
    </>
  );
}

function Stat({
  label,
  value,
  detail,
  alert,
}: {
  label: string;
  value: string | undefined;
  detail?: string | undefined;
  alert?: boolean;
}) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="px-4">
        <p className="text-muted-foreground text-sm">{label}</p>
        {value === undefined ? (
          <Skeleton className="mt-2 h-7 w-16" />
        ) : (
          <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        )}
        {detail ? (
          <p className={alert ? 'text-xs text-red-700' : 'text-muted-foreground text-xs'}>
            {detail}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}
