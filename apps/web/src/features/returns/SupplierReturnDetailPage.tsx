import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { RETURN_REASON_LABELS, type SupplierReturnDto } from '@stockflow/shared';
import { BackLink } from '@/components/BackLink';
import { History, ReasonDialog } from '@/components/document-parts';
import { FormField, fieldA11y } from '@/components/FormField';
import { DialogActions, FormAlert, FormDialog } from '@/components/form-parts';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { NotFoundPage } from '@/components/StatusPages';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { useMoney } from '@/features/settings/api';
import { ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { useSupplierReturn, useSupplierReturnAction } from './api';
import { SupplierReturnStatusBadge } from './components';

export function SupplierReturnDetailPage() {
  const { id } = useParams<{ id: string }>();
  const ret = useSupplierReturn(id);
  if (ret.isError && ret.error instanceof ApiError && ret.error.status === 404)
    return <NotFoundPage />;
  if (!ret.data) {
    return ret.isError ? (
      <p className="text-destructive text-sm">Couldn't load this return.</p>
    ) : (
      <Skeleton className="h-64 w-full" />
    );
  }
  return <Detail ret={ret.data} />;
}

type Dialog = 'reject' | 'cancel' | 'dispatch' | null;

function Detail({ ret: r }: { ret: SupplierReturnDto }) {
  const money = useMoney();
  const canWrite = usePermission('supplierReturns:write');
  const canApprove = usePermission('supplierReturns:approve');
  const canProcess = usePermission('returns:process');
  const action = useSupplierReturnAction();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [approving, setApproving] = useState(false);
  const close = (open: boolean) => !open && setDialog(null);

  const buttons: ReactNode[] = [];
  if ((r.status === 'requested' || r.status === 'approved') && canWrite) {
    buttons.push(
      <Button key="cancel" variant="ghost" onClick={() => setDialog('cancel')}>
        Cancel return
      </Button>,
    );
  }
  if (r.status === 'requested' && canApprove) {
    buttons.push(
      <Button key="reject" variant="outline" onClick={() => setDialog('reject')}>
        Reject
      </Button>,
      <Button
        key="approve"
        disabled={approving}
        onClick={async () => {
          setApproving(true);
          try {
            await action.mutateAsync({ id: r.id, action: 'approve' });
            toast.success(`${r.number} approved`);
          } catch (error) {
            toast.error(error instanceof ApiError ? error.message : 'Something went wrong');
          } finally {
            setApproving(false);
          }
        }}
      >
        {approving ? <Loader2 className="animate-spin" /> : null}
        Approve
      </Button>,
    );
  }
  if (r.status === 'approved' && canProcess) {
    buttons.push(
      <Button key="dispatch" onClick={() => setDialog('dispatch')}>
        <Send />
        Send to supplier
      </Button>,
    );
  }

  return (
    <>
      <BackLink to="/supplier-returns" label="Supplier returns" />
      <PageHeader
        title={r.number}
        description={<SupplierReturnStatusBadge status={r.status} />}
        actions={buttons.length > 0 ? buttons : null}
      />
      <div className="grid gap-6 2xl:grid-cols-3">
        <div className="grid min-w-0 gap-6 2xl:col-span-2">
          <Card>
            <CardContent>
              <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <Meta label="Supplier">
                  <Link to={`/suppliers/${r.supplier.id}`} className="hover:underline">
                    {r.supplier.name}
                  </Link>
                </Meta>
                <Meta label="From">
                  {r.warehouse.code} — {r.warehouse.name}
                </Meta>
                <Meta label="Reason">{RETURN_REASON_LABELS[r.reason]}</Meta>
                {r.purchaseOrder ? (
                  <Meta label="Purchase order">
                    <Link
                      to={`/purchase-orders/${r.purchaseOrder.id}`}
                      className="font-mono hover:underline"
                    >
                      {r.purchaseOrder.number}
                    </Link>
                  </Meta>
                ) : null}
                <Meta label="Raised by">
                  {r.requestedBy.name}, {formatDateTime(r.createdAt)}
                </Meta>
                <Meta label="Approved by">{r.approvedBy?.name ?? '—'}</Meta>
                {r.dispatchedAt ? (
                  <Meta label="Sent">
                    {formatDateTime(r.dispatchedAt)} by {r.dispatchedBy?.name}
                    {r.carrier || r.reference ? (
                      <div className="text-muted-foreground text-xs font-normal">
                        {[r.carrier, r.reference].filter(Boolean).join(' · ')}
                      </div>
                    ) : null}
                  </Meta>
                ) : null}
                {r.rejectionReason ? (
                  <Meta label="Rejected because">{r.rejectionReason}</Meta>
                ) : null}
                {r.cancelReason ? <Meta label="Cancelled because">{r.cancelReason}</Meta> : null}
                {r.notes ? (
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Meta label="Notes">{r.notes}</Meta>
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
                  <TableHead>From</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="pr-4 text-right">Unit cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="pl-4">
                      <Link to={`/products/${l.productId}`} className="font-medium hover:underline">
                        {l.name}
                      </Link>
                      <div className="text-muted-foreground font-mono text-xs">{l.sku}</div>
                    </TableCell>
                    <TableCell>
                      {l.source === 'quarantine' ? (
                        <StatusBadge tone="amber">Quarantine</StatusBadge>
                      ) : (
                        <StatusBadge tone="gray">Usable stock</StatusBadge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.quantity} {l.unit}
                    </TableCell>
                    <TableCell className="pr-4 text-right tabular-nums">
                      {money(l.unitCost)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
        <Card className="self-start">
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            <History entries={r.history} />
          </CardContent>
        </Card>
      </div>

      <FormDialog
        open={dialog === 'dispatch'}
        onOpenChange={close}
        title="Send to supplier"
        description={`${r.totalQuantity} units leave ${r.warehouse.code}. This can't be undone.`}
      >
        <DispatchForm ret={r} onDone={() => setDialog(null)} />
      </FormDialog>
      <ReasonDialog
        open={dialog === 'reject'}
        onOpenChange={close}
        title="Reject supplier return"
        description="The goods stay where they are."
        confirmLabel="Reject"
        destructive
        onConfirm={async (reason) => {
          await action.mutateAsync({ id: r.id, action: 'reject', body: { reason } });
          toast.success(`${r.number} rejected`);
        }}
      />
      <ReasonDialog
        open={dialog === 'cancel'}
        onOpenChange={close}
        title="Cancel supplier return"
        description="Nothing has been sent, so no stock changes."
        confirmLabel="Cancel return"
        destructive
        onConfirm={async (reason) => {
          await action.mutateAsync({ id: r.id, action: 'cancel', body: { reason } });
          toast.success(`${r.number} cancelled`);
        }}
      />
    </>
  );
}

function DispatchForm({ ret: r, onDone }: { ret: SupplierReturnDto; onDone: () => void }) {
  const action = useSupplierReturnAction();
  const [carrier, setCarrier] = useState('');
  const [reference, setReference] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async () => {
    setFormError(null);
    try {
      await action.mutateAsync({
        id: r.id,
        action: 'dispatch',
        body: { carrier: carrier.trim(), reference: reference.trim() },
      });
      toast.success(`${r.number} sent`);
      onDone();
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    }
  };

  return (
    <form
      id="dispatch-srn"
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <FormAlert message={formError} />
      <FormField id="srn-carrier" label="Carrier">
        <Input
          {...fieldA11y('srn-carrier', undefined)}
          value={carrier}
          maxLength={100}
          placeholder="Optional"
          onChange={(event) => setCarrier(event.target.value)}
        />
      </FormField>
      <FormField
        id="srn-reference"
        label="Supplier return authorisation"
        hint="Their RA or RMA number"
      >
        <Input
          {...fieldA11y('srn-reference', undefined, 'hint')}
          value={reference}
          maxLength={100}
          onChange={(event) => setReference(event.target.value)}
        />
      </FormField>
      <DialogActions
        formId="dispatch-srn"
        submitLabel="Send"
        pending={action.isPending}
        onCancel={onDone}
      />
    </form>
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
