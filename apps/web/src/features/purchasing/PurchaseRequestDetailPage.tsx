import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { minorToDecimal, type PurchaseRequestDto } from '@stockflow/shared';
import { BackLink } from '@/components/BackLink';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FormField, fieldA11y } from '@/components/FormField';
import { DialogActions, FormAlert, FormDialog } from '@/components/form-parts';
import { PageHeader } from '@/components/PageHeader';
import { NotFoundPage } from '@/components/StatusPages';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { useCurrentUser } from '@/features/auth/auth-context';
import { usePartners } from '@/features/partners/api';
import { ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import {
  useConvertPurchaseRequest,
  useDeletePurchaseRequest,
  usePurchaseRequest,
  usePurchaseRequestAction,
  useSupplierPrices,
} from './api';
import { History, ReasonDialog } from '@/components/document-parts';
import { PurchaseRequestStatusBadge } from './components';

type Dialog = 'reject' | 'cancel' | 'delete' | 'convert' | null;

export function PurchaseRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const request = usePurchaseRequest(id);

  if (request.isError && request.error instanceof ApiError && request.error.status === 404) {
    return <NotFoundPage />;
  }
  if (!request.data) {
    return request.isError ? (
      <p className="text-destructive text-sm">Couldn't load this request.</p>
    ) : (
      <Skeleton className="h-64 w-full" />
    );
  }
  return <RequestDetail request={request.data} />;
}

function RequestDetail({ request: pr }: { request: PurchaseRequestDto }) {
  const navigate = useNavigate();
  const { user, permissions } = useCurrentUser();
  const action = usePurchaseRequestAction();
  const remove = useDeletePurchaseRequest();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const isOwner = pr.requestedBy.id === user.id || user.role === 'admin';
  const canApprove = permissions.includes('purchaseRequests:approve');
  const canOrder = permissions.includes('purchaseOrders:write');
  const selfApproval = pr.requestedBy.id === user.id && user.role !== 'admin';

  const run = async (name: 'submit' | 'approve') => {
    setBusy(name);
    try {
      await action.mutateAsync({ id: pr.id, action: name });
      toast.success(name === 'submit' ? 'Submitted for approval' : 'Request approved');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  const buttons: ReactNode[] = [];
  if (pr.status === 'draft' && isOwner) {
    buttons.push(
      <Button key="delete" variant="ghost" onClick={() => setDialog('delete')}>
        Delete
      </Button>,
      <Button key="edit" variant="outline" asChild>
        <Link to={`/purchase-requests/${pr.id}/edit`}>Edit</Link>
      </Button>,
      <Button key="submit" onClick={() => void run('submit')} disabled={busy !== null}>
        {busy === 'submit' ? <Loader2 className="animate-spin" /> : null}
        Submit for approval
      </Button>,
    );
  }
  // Drafts are deleted rather than cancelled.
  if ((pr.status === 'submitted' || pr.status === 'approved') && (isOwner || canApprove)) {
    buttons.push(
      <Button key="cancel" variant="ghost" onClick={() => setDialog('cancel')}>
        Cancel request
      </Button>,
    );
  }
  if (pr.status === 'submitted' && canApprove) {
    buttons.push(
      <Button key="reject" variant="outline" onClick={() => setDialog('reject')}>
        Reject
      </Button>,
      <Button
        key="approve"
        onClick={() => void run('approve')}
        disabled={busy !== null || selfApproval}
        title={selfApproval ? 'Someone other than the requester must approve' : undefined}
      >
        {busy === 'approve' ? <Loader2 className="animate-spin" /> : null}
        Approve
      </Button>,
    );
  }
  if (pr.status === 'approved' && canOrder) {
    buttons.push(
      <Button key="convert" onClick={() => setDialog('convert')}>
        Create purchase order
      </Button>,
    );
  }

  return (
    <>
      <BackLink to="/purchase-requests" label="Purchase requests" />
      <PageHeader
        title={pr.number}
        description={<PurchaseRequestStatusBadge status={pr.status} />}
        actions={buttons.length > 0 ? buttons : null}
      />
      {selfApproval && pr.status === 'submitted' && canApprove ? (
        <p className="text-muted-foreground -mt-3 mb-4 text-sm">
          You raised this request, so someone else must approve it.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid gap-6 lg:col-span-2">
          <Card>
            <CardContent>
              <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <Meta label="Deliver to">
                  {pr.warehouse.code} — {pr.warehouse.name}
                </Meta>
                <Meta label="Needed by">{formatDate(pr.neededBy)}</Meta>
                <Meta label="Requested by">{pr.requestedBy.name}</Meta>
                <Meta label="Preferred supplier">{pr.supplier?.name ?? 'No preference'}</Meta>
                <Meta label="Purchase order">
                  {pr.purchaseOrder ? (
                    <Link
                      to={`/purchase-orders/${pr.purchaseOrder.id}`}
                      className="font-mono hover:underline"
                    >
                      {pr.purchaseOrder.number}
                    </Link>
                  ) : (
                    '—'
                  )}
                </Meta>
                {pr.rejectionReason ? (
                  <Meta label="Rejection reason">{pr.rejectionReason}</Meta>
                ) : null}
                {pr.notes ? (
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Meta label="Notes">{pr.notes}</Meta>
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
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="pr-4">Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pr.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="pl-4">
                      <Link to={`/products/${l.productId}`} className="font-medium hover:underline">
                        {l.name}
                      </Link>
                      <div className="text-muted-foreground font-mono text-xs">{l.sku}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.quantity} <span className="text-muted-foreground text-xs">{l.unit}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground pr-4">{l.note || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            <History entries={pr.history} />
          </CardContent>
        </Card>
      </div>

      <ReasonDialog
        open={dialog === 'reject'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Reject request"
        description="The requester will see your reason."
        confirmLabel="Reject"
        destructive
        onConfirm={async (reason) => {
          await action.mutateAsync({ id: pr.id, action: 'reject', reason });
          toast.success('Request rejected');
        }}
      />
      <ReasonDialog
        open={dialog === 'cancel'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Cancel request"
        description="A cancelled request can't be reopened."
        confirmLabel="Cancel request"
        destructive
        onConfirm={async (reason) => {
          await action.mutateAsync({ id: pr.id, action: 'cancel', reason });
          toast.success('Request cancelled');
        }}
      />
      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Delete draft"
        description={`Delete ${pr.number}? This can't be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          try {
            await remove.mutateAsync(pr.id);
            toast.success(`${pr.number} deleted`);
            void navigate('/purchase-requests');
          } catch (error) {
            toast.error(error instanceof ApiError ? error.message : 'Could not delete');
          }
        }}
      />
      <FormDialog
        open={dialog === 'convert'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Create purchase order"
        description="Choose the supplier. Lines use the supplier's prices where they have one, otherwise the product cost. You can review the draft before submitting it."
        wide
      >
        <ConvertForm request={pr} onDone={() => setDialog(null)} />
      </FormDialog>
    </>
  );
}

function ConvertForm({ request, onDone }: { request: PurchaseRequestDto; onDone: () => void }) {
  const navigate = useNavigate();
  const suppliers = usePartners('suppliers', { status: 'active', pageSize: 100 });
  const convert = useConvertPurchaseRequest();
  const [supplierId, setSupplierId] = useState(request.supplier?.id ?? '');
  const prices = useSupplierPrices(supplierId || undefined);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const priceFor = new Map((prices.data ?? []).map((p) => [p.product.id, p.unitCost]));

  const submit = async () => {
    if (!supplierId) {
      setError('Select a supplier');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const { purchaseOrderId } = await convert.mutateAsync({ id: request.id, supplierId });
      toast.success('Draft purchase order created');
      onDone();
      void navigate(`/purchase-orders/${purchaseOrderId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <form
        id="convert-form"
        noValidate
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <FormAlert message={error} />
        <FormField id="convert-supplier" label="Supplier">
          <Select value={supplierId} onValueChange={setSupplierId}>
            <SelectTrigger {...fieldA11y('convert-supplier', undefined)} className="w-full">
              <SelectValue placeholder="Select a supplier" />
            </SelectTrigger>
            <SelectContent>
              {(suppliers.data?.data ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                  {s.leadTimeDays !== null ? ` · ${s.leadTimeDays} day lead time` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        {supplierId ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Supplier price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {request.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    <span className="font-mono text-xs">{l.sku}</span> {l.name}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{l.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {prices.isPending ? (
                      '…'
                    ) : priceFor.has(l.productId) ? (
                      minorToDecimal(priceFor.get(l.productId)!)
                    ) : (
                      <span className="text-muted-foreground">No price — product cost</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </form>
      <DialogActions
        formId="convert-form"
        submitLabel="Create draft order"
        pending={pending}
        onCancel={onDone}
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
