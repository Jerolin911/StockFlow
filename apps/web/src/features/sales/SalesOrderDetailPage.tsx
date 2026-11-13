import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ClipboardList, Loader2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { basisPointsToPercent, type SalesOrderDto } from '@stockflow/shared';
import { BackLink } from '@/components/BackLink';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { History, ReasonDialog } from '@/components/document-parts';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { NotFoundPage } from '@/components/StatusPages';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCurrentUser } from '@/features/auth/auth-context';
import { useCustomerReturns } from '@/features/returns/api';
import { CustomerReturnStatusBadge } from '@/features/returns/components';
import { useMoney } from '@/features/settings/api';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  useAvailability,
  useDeleteSalesOrder,
  useSalesOrder,
  useSalesOrderAction,
  useShipments,
} from './api';
import { SalesOrderStatusBadge, ShipmentStatusBadge } from './components';
import { Availability } from './SalesLinesEditor';

export function SalesOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const order = useSalesOrder(id);
  if (order.isError && order.error instanceof ApiError && order.error.status === 404)
    return <NotFoundPage />;
  if (!order.data) {
    return order.isError ? (
      <p className="text-destructive text-sm">Couldn't load this sales order.</p>
    ) : (
      <Skeleton className="h-64 w-full" />
    );
  }
  return <OrderDetail order={order.data} />;
}

type Dialog = 'cancel' | 'delete' | null;

function OrderDetail({ order: so }: { order: SalesOrderDto }) {
  const navigate = useNavigate();
  const money = useMoney();
  const { permissions } = useCurrentUser();
  const action = useSalesOrderAction();
  const remove = useDeleteSalesOrder();
  const shipments = useShipments({ salesOrderId: so.id, pageSize: 50, sort: 'createdAt' });
  const isDraft = so.status === 'draft';
  const availability = useAvailability(isDraft ? so.lines.map((l) => l.productId) : []);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [confirming, setConfirming] = useState(false);
  const [shortages, setShortages] = useState<Record<string, string>>({});

  const canWrite = permissions.includes('salesOrders:write');
  const canShip = permissions.includes('shipments:create');
  const canReturn = permissions.includes('customerReturns:write');
  const returns = useCustomerReturns({ salesOrderId: so.id, pageSize: 50 }, so.status !== 'draft');
  const returnable = so.lines.some((l) => l.shippedQuantity > l.returnedQuantity);
  const open = so.status === 'confirmed' || so.status === 'partially_shipped';

  const sum = (pick: (l: SalesOrderDto['lines'][number]) => number) =>
    so.lines.reduce((s, l) => s + pick(l), 0);
  const totals = {
    ordered: sum((l) => l.quantity),
    cancelled: sum((l) => l.cancelledQuantity),
    reserved: sum((l) => l.reservedQuantity),
    allocated: sum((l) => l.allocatedQuantity),
    shipped: sum((l) => l.shippedQuantity),
    delivered: sum((l) => l.deliveredQuantity),
    unallocated: sum((l) => l.unallocatedQuantity),
  };
  const openShipments = (shipments.data?.data ?? []).filter((s) =>
    ['picking', 'picked', 'packed'].includes(s.status),
  );

  const confirm = async () => {
    setConfirming(true);
    setShortages({});
    try {
      await action.mutateAsync({ id: so.id, action: 'confirm' });
      toast.success(`${so.number} confirmed and stock reserved`);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INSUFFICIENT_STOCK') {
        setShortages(Object.fromEntries(error.details.map((d) => [d.path, d.message])));
      }
      toast.error(error instanceof ApiError ? error.message : 'Something went wrong');
    } finally {
      setConfirming(false);
    }
  };

  const buttons: ReactNode[] = [];
  if (isDraft && canWrite) {
    buttons.push(
      <Button key="delete" variant="ghost" onClick={() => setDialog('delete')}>
        Delete
      </Button>,
      <Button key="edit" variant="outline" asChild>
        <Link to={`/sales-orders/${so.id}/edit`}>Edit</Link>
      </Button>,
      <Button key="confirm" onClick={() => void confirm()} disabled={confirming}>
        {confirming ? <Loader2 className="animate-spin" /> : null}
        Confirm and reserve stock
      </Button>,
    );
  }
  if (open && canWrite) {
    buttons.push(
      <Button key="cancel" variant="ghost" onClick={() => setDialog('cancel')}>
        {totals.shipped > 0 ? 'Cancel remaining' : 'Cancel order'}
      </Button>,
    );
  }
  if (canReturn && returnable) {
    buttons.push(
      <Button key="return" variant="outline" asChild>
        <Link to={`/customer-returns/new?salesOrderId=${so.id}`}>
          <Undo2 />
          Create return
        </Link>
      </Button>,
    );
  }
  if (open && canShip && totals.unallocated > 0) {
    buttons.push(
      <Button key="ship" asChild>
        <Link to={`/shipments/new?salesOrderId=${so.id}`}>
          <ClipboardList />
          Create pick list
        </Link>
      </Button>,
    );
  }

  const cancelDescription =
    totals.shipped > 0
      ? `Cancels the ${totals.reserved} units that haven't shipped and releases their reservation. Shipped goods aren't affected.`
      : `Releases the ${totals.reserved} reserved units back to available stock.`;

  return (
    <>
      <BackLink to="/sales-orders" label="Sales orders" />
      <PageHeader
        title={so.number}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <SalesOrderStatusBadge status={so.status} />
            {so.isOverdue ? <StatusBadge tone="red">Overdue</StatusBadge> : null}
          </span>
        }
        actions={buttons.length > 0 ? buttons : null}
      />

      <div className="grid gap-6 2xl:grid-cols-3">
        <div className="grid min-w-0 gap-6 2xl:col-span-2">
          <Card>
            <CardContent>
              <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <Meta label="Customer">{so.customer.name}</Meta>
                <Meta label="Ship from">
                  {so.warehouse.code} — {so.warehouse.name}
                </Meta>
                <Meta label="Required by">
                  <span className={cn(so.isOverdue && 'text-red-700')}>
                    {formatDate(so.requiredDate)}
                  </span>
                </Meta>
                <Meta label="Order date">{formatDate(so.orderDate)}</Meta>
                <Meta label="Customer reference">{so.customerReference || '—'}</Meta>
                <Meta label="Confirmed by">
                  {so.confirmedBy
                    ? `${so.confirmedBy.name}, ${formatDateTime(so.confirmedAt)}`
                    : '—'}
                </Meta>
                <div className="sm:col-span-2">
                  <Meta label="Shipping address">
                    <span className="whitespace-pre-line">
                      {so.customerErased
                        ? 'Erased at the customer’s request'
                        : so.shippingAddress || '—'}
                    </span>
                  </Meta>
                </div>
                <Meta label="Created by">{so.createdBy.name}</Meta>
                {so.cancelReason ? (
                  <Meta label="Cancellation reason">{so.cancelReason}</Meta>
                ) : null}
                {so.notes ? (
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Meta label="Notes">{so.notes}</Meta>
                  </div>
                ) : null}
              </dl>
            </CardContent>
          </Card>

          {isDraft ? (
            <DraftLines order={so} availability={availability.data} shortages={shortages} />
          ) : (
            <Card className="gap-0 overflow-hidden py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Product</TableHead>
                    <TableHead className="text-right">Ordered</TableHead>
                    <TableHead className="text-right">Reserved</TableHead>
                    <TableHead className="text-right">On pick lists</TableHead>
                    <TableHead className="text-right">Shipped</TableHead>
                    <TableHead className="text-right">Delivered</TableHead>
                    <TableHead className="pr-4 text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {so.lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="pl-4">
                        <ProductCell line={l} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {l.quantity}
                        {l.cancelledQuantity > 0 ? (
                          <div className="text-muted-foreground text-xs">
                            {l.cancelledQuantity} cancelled
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {l.reservedQuantity}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {l.allocatedQuantity}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{l.shippedQuantity}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {l.deliveredQuantity}
                      </TableCell>
                      <TableCell className="pr-4 text-right tabular-nums">
                        <LineTotal line={l} money={money} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="pl-4">Total</TableCell>
                    <TableCell className="text-right tabular-nums">{totals.ordered}</TableCell>
                    <TableCell className="text-right tabular-nums">{totals.reserved}</TableCell>
                    <TableCell className="text-right tabular-nums">{totals.allocated}</TableCell>
                    <TableCell className="text-right tabular-nums">{totals.shipped}</TableCell>
                    <TableCell className="text-right tabular-nums">{totals.delivered}</TableCell>
                    <TableCell className="pr-4 text-right tabular-nums">
                      <OrderTotal order={so} money={money} />
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
              {open && totals.unallocated > 0 ? (
                <p className="text-muted-foreground border-t px-4 py-3 text-sm">
                  {totals.unallocated === 1
                    ? '1 unit is reserved but not yet on a pick list.'
                    : `${totals.unallocated} units are reserved but not yet on a pick list.`}
                </p>
              ) : null}
            </Card>
          )}

          {!isDraft ? (
            <Card className="gap-0 overflow-hidden pb-0">
              <CardHeader className="pb-4">
                <CardTitle>Shipments</CardTitle>
              </CardHeader>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Number</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="hidden md:table-cell">Carrier</TableHead>
                    <TableHead className="pr-6">Dispatched</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(shipments.data?.data ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="text-muted-foreground py-6 text-center text-sm"
                      >
                        {shipments.isPending ? 'Loading…' : 'No shipments yet.'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    shipments.data!.data.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="pl-6">
                          <Link
                            to={`/shipments/${s.id}`}
                            className="font-mono text-xs font-medium hover:underline"
                          >
                            {s.number}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <ShipmentStatusBadge status={s.status} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {s.totals.picked ?? s.totals.requested}
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {s.carrier ? (
                            <>
                              {s.carrier}
                              {s.trackingNumber ? (
                                <span className="text-muted-foreground font-mono text-xs">
                                  {' '}
                                  {s.trackingNumber}
                                </span>
                              ) : null}
                            </>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell className="pr-6">{formatDateTime(s.dispatchedAt)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Card>
          ) : null}
          {(returns.data?.data ?? []).length > 0 ? (
            <Card className="gap-0 overflow-hidden pb-0">
              <CardHeader className="pb-4">
                <CardTitle>Returns</CardTitle>
              </CardHeader>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Number</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="pr-6 text-right">Restocked</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {returns.data!.data.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="pl-6">
                        <Link
                          to={`/customer-returns/${r.id}`}
                          className="font-mono text-xs font-medium hover:underline"
                        >
                          {r.number}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <CustomerReturnStatusBadge status={r.status} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.totals.requested}
                      </TableCell>
                      <TableCell className="pr-6 text-right tabular-nums">
                        {r.status === 'completed' ? r.totals.restocked : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          ) : null}
        </div>

        <Card className="self-start">
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            <History entries={so.history} />
          </CardContent>
        </Card>
      </div>

      <ReasonDialog
        open={dialog === 'cancel'}
        onOpenChange={(next) => !next && setDialog(null)}
        title={totals.shipped > 0 ? 'Cancel remaining quantities' : 'Cancel sales order'}
        description={
          openShipments.length > 0
            ? `${cancelDescription} Open pick lists (${openShipments.map((s) => s.number).join(', ')}) will be cancelled.`
            : cancelDescription
        }
        confirmLabel={totals.shipped > 0 ? 'Cancel remaining' : 'Cancel order'}
        destructive
        onConfirm={async (reason) => {
          await action.mutateAsync({ id: so.id, action: 'cancel', reason });
          toast.success(`${so.number}: reservation released`);
        }}
      />
      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={(next) => !next && setDialog(null)}
        title="Delete draft"
        description={`Delete ${so.number}? This can't be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          try {
            await remove.mutateAsync(so.id);
            toast.success(`${so.number} deleted`);
            void navigate('/sales-orders');
          } catch (error) {
            toast.error(error instanceof ApiError ? error.message : 'Could not delete');
          }
        }}
      />
    </>
  );
}

type Money = ReturnType<typeof useMoney>;
type Line = SalesOrderDto['lines'][number];

function DraftLines({
  order: so,
  availability,
  shortages,
}: {
  order: SalesOrderDto;
  availability: ReturnType<typeof useAvailability>['data'];
  shortages: Record<string, string>;
}) {
  const money = useMoney();
  const short = so.lines.filter((l) => {
    const here = availability?.get(l.productId)?.find((w) => w.warehouse.id === so.warehouse.id);
    return availability && (here?.available ?? 0) < l.quantity;
  });
  return (
    <Card className="gap-0 overflow-hidden py-0">
      {short.length > 0 ? (
        <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {short.length === 1 ? '1 line is' : `${short.length} lines are`} short in{' '}
          {so.warehouse.code}. Confirm once stock arrives, or change the quantities or warehouse.
        </p>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Product</TableHead>
            <TableHead className="text-right">Quantity</TableHead>
            <TableHead>Available in {so.warehouse.code}</TableHead>
            <TableHead className="pr-4 text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {so.lines.map((l, index) => (
            <TableRow key={l.id}>
              <TableCell className="pl-4">
                <ProductCell line={l} />
              </TableCell>
              <TableCell className="text-right tabular-nums">{l.quantity}</TableCell>
              <TableCell>
                <Availability
                  stock={availability?.get(l.productId)}
                  warehouseId={so.warehouse.id}
                  quantity={l.quantity}
                  unit={l.unit}
                />
                {shortages[`lines.${index}.quantity`] ? (
                  <p className="text-destructive mt-0.5 text-xs">
                    {shortages[`lines.${index}.quantity`]}
                  </p>
                ) : null}
              </TableCell>
              <TableCell className="pr-4 text-right tabular-nums">
                <LineTotal line={l} money={money} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="pl-4" colSpan={3}>
              Total
            </TableCell>
            <TableCell className="pr-4 text-right tabular-nums">
              <OrderTotal order={so} money={money} />
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </Card>
  );
}

function ProductCell({ line }: { line: Line }) {
  return (
    <>
      <Link to={`/products/${line.productId}`} className="font-medium hover:underline">
        {line.name}
      </Link>
      <div className="text-muted-foreground font-mono text-xs">{line.sku}</div>
    </>
  );
}

function LineTotal({ line: l, money }: { line: Line; money: Money }) {
  return (
    <>
      <div>{money(l.lineTotal)}</div>
      <div className="text-muted-foreground text-xs">
        {l.quantity} × {money(l.unitPrice)}
        {l.discountRate > 0 ? `, −${basisPointsToPercent(l.discountRate)}%` : ''}
      </div>
    </>
  );
}

function OrderTotal({ order: so, money }: { order: SalesOrderDto; money: Money }) {
  return (
    <>
      <div>{money(so.total)}</div>
      <div className="text-muted-foreground text-xs font-normal">
        {so.discountTotal > 0 ? `${money(so.discountTotal)} discount · ` : ''}
        {money(so.taxTotal)} tax
      </div>
    </>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium">{children}</dd>
    </div>
  );
}
