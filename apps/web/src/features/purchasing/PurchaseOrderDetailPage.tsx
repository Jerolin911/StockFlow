import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Loader2, PackageCheck } from 'lucide-react';
import { toast } from 'sonner';
import type { PurchaseOrderDto } from '@stockflow/shared';
import { BackLink } from '@/components/BackLink';
import { ConfirmDialog } from '@/components/ConfirmDialog';
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
import { useMoney } from '@/features/settings/api';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  useDeletePurchaseOrder,
  useGoodsReceipts,
  usePurchaseOrder,
  usePurchaseOrderAction,
  type PurchaseOrderAction,
} from './api';
import { History, ReasonDialog } from '@/components/document-parts';
import { PurchaseOrderStatusBadge } from './components';

export function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const order = usePurchaseOrder(id);
  if (order.isError && order.error instanceof ApiError && order.error.status === 404)
    return <NotFoundPage />;
  if (!order.data) {
    return order.isError ? (
      <p className="text-destructive text-sm">Couldn't load this purchase order.</p>
    ) : (
      <Skeleton className="h-64 w-full" />
    );
  }
  return <OrderDetail order={order.data} />;
}

type Dialog = 'reject' | 'cancel' | 'close' | 'delete' | null;

function OrderDetail({ order: po }: { order: PurchaseOrderDto }) {
  const navigate = useNavigate();
  const money = useMoney();
  const { user, permissions } = useCurrentUser();
  const action = usePurchaseOrderAction();
  const remove = useDeletePurchaseOrder();
  const receipts = useGoodsReceipts({ purchaseOrderId: po.id, pageSize: 50 });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<PurchaseOrderAction | null>(null);

  const canWrite = permissions.includes('purchaseOrders:write');
  const canApprove = permissions.includes('purchaseOrders:approve');
  const canReceive = permissions.includes('goodsReceipts:create');
  const selfApproval = po.createdBy.id === user.id && user.role !== 'admin';
  const receivable = po.status === 'approved' || po.status === 'partially_received';

  const run = async (name: 'submit' | 'approve', success: string) => {
    setBusy(name);
    try {
      await action.mutateAsync({ id: po.id, action: name });
      toast.success(success);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  const buttons: ReactNode[] = [];
  if (po.status === 'draft' && canWrite) {
    buttons.push(
      <Button key="delete" variant="ghost" onClick={() => setDialog('delete')}>
        Delete
      </Button>,
      <Button key="edit" variant="outline" asChild>
        <Link to={`/purchase-orders/${po.id}/edit`}>Edit</Link>
      </Button>,
      <Button
        key="submit"
        onClick={() => void run('submit', 'Submitted for approval')}
        disabled={busy !== null}
      >
        {busy === 'submit' ? <Loader2 className="animate-spin" /> : null}
        Submit for approval
      </Button>,
    );
  }
  if (po.status === 'pending_approval' && canApprove) {
    buttons.push(
      <Button key="reject" variant="outline" onClick={() => setDialog('reject')}>
        Reject
      </Button>,
      <Button
        key="approve"
        onClick={() => void run('approve', 'Purchase order approved')}
        disabled={busy !== null || selfApproval}
        title={selfApproval ? 'Someone other than the creator must approve' : undefined}
      >
        {busy === 'approve' ? <Loader2 className="animate-spin" /> : null}
        Approve
      </Button>,
    );
  }
  if (['pending_approval', 'approved'].includes(po.status) && po.receiptCount === 0 && canWrite) {
    buttons.unshift(
      <Button key="cancel" variant="ghost" onClick={() => setDialog('cancel')}>
        Cancel order
      </Button>,
    );
  }
  if (po.status === 'partially_received' && canWrite) {
    buttons.push(
      <Button key="close" variant="outline" onClick={() => setDialog('close')}>
        Close remaining
      </Button>,
    );
  }
  if (receivable && canReceive) {
    buttons.push(
      <Button key="receive" asChild>
        <Link to={`/goods-receipts/new?purchaseOrderId=${po.id}`}>
          <PackageCheck />
          Receive goods
        </Link>
      </Button>,
    );
  }

  const totals = po.lines.reduce(
    (acc, l) => ({
      ordered: acc.ordered + l.quantity,
      received: acc.received + l.receivedQuantity,
      rejected: acc.rejected + l.rejectedQuantity,
      damaged: acc.damaged + l.damagedQuantity,
      pending: acc.pending + l.pendingQuantity,
    }),
    { ordered: 0, received: 0, rejected: 0, damaged: 0, pending: 0 },
  );

  return (
    <>
      <BackLink to="/purchase-orders" label="Purchase orders" />
      <PageHeader
        title={po.number}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <PurchaseOrderStatusBadge status={po.status} />
            {po.isOverdue ? <StatusBadge tone="red">Overdue</StatusBadge> : null}
          </span>
        }
        actions={buttons.length > 0 ? buttons : null}
      />
      {po.status === 'pending_approval' && canApprove && selfApproval ? (
        <p className="text-muted-foreground -mt-3 mb-4 text-sm">
          You created this order, so someone else must approve it.
        </p>
      ) : null}
      {po.rejectionReason && po.status === 'draft' ? (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Returned for changes: {po.rejectionReason}
        </p>
      ) : null}

      <div className="grid gap-6 2xl:grid-cols-3">
        <div className="grid min-w-0 gap-6 2xl:col-span-2">
          <Card>
            <CardContent>
              <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <Meta label="Supplier">
                  <Link to={`/suppliers/${po.supplier.id}`} className="hover:underline">
                    {po.supplier.name}
                  </Link>
                </Meta>
                <Meta label="Deliver to">
                  {po.warehouse.code} — {po.warehouse.name}
                </Meta>
                <Meta label="Expected delivery">
                  <span className={cn(po.isOverdue && 'text-red-700')}>
                    {formatDate(po.expectedDate)}
                  </span>
                </Meta>
                <Meta label="Order date">{formatDate(po.orderDate)}</Meta>
                <Meta label="Created by">{po.createdBy.name}</Meta>
                <Meta label="Approved by">
                  {po.approvedBy ? `${po.approvedBy.name}, ${formatDateTime(po.approvedAt)}` : '—'}
                </Meta>
                {po.purchaseRequest ? (
                  <Meta label="From request">
                    <Link
                      to={`/purchase-requests/${po.purchaseRequest.id}`}
                      className="font-mono hover:underline"
                    >
                      {po.purchaseRequest.number}
                    </Link>
                  </Meta>
                ) : null}
                {po.cancelReason ? (
                  <Meta label="Cancellation reason">{po.cancelReason}</Meta>
                ) : null}
                {po.closeReason ? <Meta label="Closed because">{po.closeReason}</Meta> : null}
                {po.notes ? (
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Meta label="Notes">{po.notes}</Meta>
                  </div>
                ) : null}
              </dl>
            </CardContent>
          </Card>

          <Card className="gap-0 overflow-hidden py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Product</TableHead>
                  <TableHead className="text-right">Ordered</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Rejected</TableHead>
                  <TableHead className="text-right">Damaged</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Unit cost</TableHead>
                  <TableHead className="pr-4 text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {po.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="pl-4">
                      <Link to={`/products/${l.productId}`} className="font-medium hover:underline">
                        {l.name}
                      </Link>
                      <div className="text-muted-foreground font-mono text-xs">{l.sku}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{l.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.receivedQuantity}</TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums',
                        l.rejectedQuantity > 0 && 'text-red-700',
                      )}
                    >
                      {l.rejectedQuantity}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums',
                        l.damagedQuantity > 0 && 'text-red-700',
                      )}
                    >
                      {l.damagedQuantity}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {l.pendingQuantity}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">
                      {money(l.unitCost)}
                    </TableCell>
                    <TableCell className="pr-4 text-right tabular-nums">
                      {money(l.lineTotal)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="pl-4">Total</TableCell>
                  <TableCell className="text-right tabular-nums">{totals.ordered}</TableCell>
                  <TableCell className="text-right tabular-nums">{totals.received}</TableCell>
                  <TableCell className="text-right tabular-nums">{totals.rejected}</TableCell>
                  <TableCell className="text-right tabular-nums">{totals.damaged}</TableCell>
                  <TableCell className="text-right tabular-nums">{totals.pending}</TableCell>
                  <TableCell className="hidden lg:table-cell" />
                  <TableCell className="pr-4 text-right tabular-nums">
                    <div>{money(po.total)}</div>
                    <div className="text-muted-foreground text-xs font-normal">
                      {money(po.subtotal)} + {money(po.taxTotal)} tax
                    </div>
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </Card>

          <Card className="gap-0 overflow-hidden pb-0">
            <CardHeader className="pb-4">
              <CardTitle>Goods receipts</CardTitle>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Number</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead className="text-right">Accepted</TableHead>
                  <TableHead className="text-right">Rejected</TableHead>
                  <TableHead className="pr-6 text-right">Damaged</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(receipts.data?.data ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-muted-foreground py-6 text-center text-sm"
                    >
                      {receipts.isPending ? 'Loading…' : 'Nothing received yet.'}
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
                      </TableCell>
                      <TableCell>{formatDateTime(grn.receivedAt)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {grn.totals.accepted}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {grn.totals.rejected}
                      </TableCell>
                      <TableCell className="pr-6 text-right tabular-nums">
                        {grn.totals.damaged}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </div>

        <Card className="self-start">
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            <History entries={po.history} />
          </CardContent>
        </Card>
      </div>

      <ReasonDialog
        open={dialog === 'reject'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Return for changes"
        description="The order goes back to draft with your reason."
        confirmLabel="Reject"
        destructive
        onConfirm={async (reason) => {
          await action.mutateAsync({ id: po.id, action: 'reject', reason });
          toast.success('Returned to draft');
        }}
      />
      <ReasonDialog
        open={dialog === 'cancel'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Cancel purchase order"
        description={
          po.purchaseRequest
            ? `${po.purchaseRequest.number} will return to approved so it can be ordered again.`
            : "A cancelled order can't be reopened."
        }
        confirmLabel="Cancel order"
        destructive
        onConfirm={async (reason) => {
          await action.mutateAsync({ id: po.id, action: 'cancel', reason });
          toast.success(`${po.number} cancelled`);
        }}
      />
      <ReasonDialog
        open={dialog === 'close'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Close remaining quantities"
        description={`Stops waiting for the ${totals.pending} outstanding units. Received stock is unaffected.`}
        confirmLabel="Close order"
        onConfirm={async (reason) => {
          await action.mutateAsync({ id: po.id, action: 'close', reason });
          toast.success(`${po.number} closed`);
        }}
      />
      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Delete draft"
        description={`Delete ${po.number}? This can't be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          try {
            await remove.mutateAsync(po.id);
            toast.success(`${po.number} deleted`);
            void navigate('/purchase-orders');
          } catch (error) {
            toast.error(error instanceof ApiError ? error.message : 'Could not delete');
          }
        }}
      />
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
