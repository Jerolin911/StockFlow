import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import type { TransferDto } from '@stockflow/shared';
import { BackLink } from '@/components/BackLink';
import { History, ReasonDialog } from '@/components/document-parts';
import { FormField, fieldA11y } from '@/components/FormField';
import { DialogActions, FormAlert, FormDialog } from '@/components/form-parts';
import { PageHeader } from '@/components/PageHeader';
import { NotFoundPage } from '@/components/StatusPages';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import { useAvailability } from '@/features/sales/api';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useTransfer, useTransferAction, type TransferAction } from './api';
import { TransferStatusBadge } from './components';

export function TransferDetailPage() {
  const { id } = useParams<{ id: string }>();
  const transfer = useTransfer(id);
  if (transfer.isError && transfer.error instanceof ApiError && transfer.error.status === 404)
    return <NotFoundPage />;
  if (!transfer.data) {
    return transfer.isError ? (
      <p className="text-destructive text-sm">Couldn't load this transfer.</p>
    ) : (
      <Skeleton className="h-64 w-full" />
    );
  }
  return <Detail key={transfer.data.id} transfer={transfer.data} />;
}

type Dialog = 'reject' | 'cancel' | 'close' | 'dispatch' | null;
const WHOLE = /^\d{1,9}$/;

/** Runs a transfer action and keeps field errors for the form that sent it. */
function useAction(transfer: TransferDto) {
  const mutation = useTransferAction();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const run = async (action: TransferAction, success: string) => {
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      await mutation.mutateAsync({ id: transfer.id, ...action });
      toast.success(success);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.details.length > 0) {
        setErrors(Object.fromEntries(error.details.map((d) => [d.path, d.message])));
      }
      setFormError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
      return false;
    } finally {
      setPending(false);
    }
  };
  return { run, pending, errors, setErrors, formError };
}

function Detail({ transfer: t }: { transfer: TransferDto }) {
  const { user, permissions } = useCurrentUser();
  const action = useTransferAction();
  const [approving, setApproving] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = (open: boolean) => !open && setDialog(null);

  const canMove = permissions.includes('stock:transfer');
  const canApprove = permissions.includes('transfers:approve');
  const isOwner = t.requestedBy.id === user.id;
  const selfApproval = isOwner && user.role !== 'admin';
  const inTransit = t.status === 'in_transit' || t.status === 'partially_received';
  const availability = useAvailability(
    t.status === 'requested' || t.status === 'approved' ? t.lines.map((l) => l.productId) : [],
  );

  const buttons: ReactNode[] = [];
  if ((t.status === 'requested' || t.status === 'approved') && (isOwner || canApprove) && canMove) {
    buttons.push(
      <Button key="cancel" variant="ghost" onClick={() => setDialog('cancel')}>
        Cancel request
      </Button>,
    );
  }
  if (t.status === 'requested' && (isOwner || canApprove) && canMove) {
    buttons.push(
      <Button key="edit" variant="outline" asChild>
        <Link to={`/stock/transfers/${t.id}/edit`}>Edit</Link>
      </Button>,
    );
  }
  if (t.status === 'requested' && canApprove) {
    buttons.push(
      <Button key="reject" variant="outline" onClick={() => setDialog('reject')}>
        Reject
      </Button>,
      <Button
        key="approve"
        disabled={approving || selfApproval}
        title={selfApproval ? 'Someone other than the requester must approve' : undefined}
        onClick={async () => {
          setApproving(true);
          try {
            await action.mutateAsync({ id: t.id, action: 'approve' });
            toast.success(`${t.number} approved`);
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
  if (t.status === 'approved' && canMove) {
    buttons.push(
      <Button key="dispatch" onClick={() => setDialog('dispatch')}>
        <Send />
        Dispatch
      </Button>,
    );
  }
  if (inTransit && canApprove) {
    buttons.push(
      <Button key="close" variant="outline" onClick={() => setDialog('close')}>
        Close short
      </Button>,
    );
  }

  const sum = (pick: (l: TransferDto['lines'][number]) => number) =>
    t.lines.reduce((s, l) => s + pick(l), 0);

  return (
    <>
      <BackLink to="/stock/transfers" label="Transfers" />
      <PageHeader
        title={t.number}
        description={<TransferStatusBadge status={t.status} />}
        actions={buttons.length > 0 ? buttons : null}
      />
      {t.status === 'requested' && canApprove && selfApproval ? (
        <p className="text-muted-foreground -mt-3 mb-4 text-sm">
          You requested this transfer, so someone else must approve it.
        </p>
      ) : null}

      <div className="grid gap-6 2xl:grid-cols-3">
        <div className="grid min-w-0 gap-6 2xl:col-span-2">
          <Card>
            <CardContent>
              <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <Meta label="From">
                  {t.fromWarehouse.code} — {t.fromWarehouse.name}
                </Meta>
                <Meta label="To">
                  {t.toWarehouse.code} — {t.toWarehouse.name}
                </Meta>
                <Meta label="Needed by">{formatDate(t.neededBy)}</Meta>
                <Meta label="Requested by">
                  {t.requestedBy.name}, {formatDateTime(t.createdAt)}
                </Meta>
                <Meta label="Approved by">{t.approvedBy?.name ?? '—'}</Meta>
                <Meta label="Dispatched">
                  {t.dispatchedAt
                    ? `${formatDateTime(t.dispatchedAt)} by ${t.dispatchedBy?.name ?? ''}`
                    : '—'}
                </Meta>
                {t.carrier || t.reference ? (
                  <Meta label="Carrier">
                    {[t.carrier, t.reference].filter(Boolean).join(' · ')}
                  </Meta>
                ) : null}
                {t.lossAdjustment ? (
                  <Meta label="Written off in">
                    <Link
                      to={`/stock/adjustments/${t.lossAdjustment.id}`}
                      className="font-mono hover:underline"
                    >
                      {t.lossAdjustment.number}
                    </Link>
                  </Meta>
                ) : null}
                {t.rejectionReason ? (
                  <Meta label="Rejected because">{t.rejectionReason}</Meta>
                ) : null}
                {t.cancelReason ? <Meta label="Cancelled because">{t.cancelReason}</Meta> : null}
                {t.closeReason ? <Meta label="Closed because">{t.closeReason}</Meta> : null}
                {t.notes ? (
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Meta label="Notes">{t.notes}</Meta>
                  </div>
                ) : null}
              </dl>
            </CardContent>
          </Card>

          {inTransit && canMove ? (
            <ReceiveForm transfer={t} />
          ) : (
            <Card className="gap-0 overflow-hidden py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Product</TableHead>
                    <TableHead className="text-right">Requested</TableHead>
                    {t.status === 'requested' || t.status === 'approved' ? (
                      <TableHead className="pr-4 text-right">
                        Available in {t.fromWarehouse.code}
                      </TableHead>
                    ) : (
                      <>
                        <TableHead className="text-right">Dispatched</TableHead>
                        <TableHead className="text-right">Received</TableHead>
                        <TableHead className="text-right">Damaged</TableHead>
                        <TableHead className="text-right">Lost</TableHead>
                        <TableHead className="pr-4 text-right">In transit</TableHead>
                      </>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {t.lines.map((l) => {
                    const available = availability.data
                      ?.get(l.productId)
                      ?.find((w) => w.warehouse.id === t.fromWarehouse.id)?.available;
                    return (
                      <TableRow key={l.id}>
                        <TableCell className="pl-4">
                          <ProductCell line={l} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{l.quantity}</TableCell>
                        {t.status === 'requested' || t.status === 'approved' ? (
                          <TableCell
                            className={cn(
                              'pr-4 text-right tabular-nums',
                              available !== undefined && available < l.quantity && 'text-red-700',
                            )}
                          >
                            {available ?? '—'}
                          </TableCell>
                        ) : (
                          <>
                            <TableCell className="text-right tabular-nums">
                              {l.dispatchedQuantity}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {l.receivedQuantity}
                            </TableCell>
                            <TableCell
                              className={cn(
                                'text-right tabular-nums',
                                l.damagedQuantity > 0 && 'text-amber-800',
                              )}
                            >
                              {l.damagedQuantity}
                            </TableCell>
                            <TableCell
                              className={cn(
                                'text-right tabular-nums',
                                l.lostQuantity > 0 && 'text-red-700',
                              )}
                            >
                              {l.lostQuantity}
                            </TableCell>
                            <TableCell className="pr-4 text-right font-medium tabular-nums">
                              {l.inTransitQuantity}
                            </TableCell>
                          </>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
                {t.status !== 'requested' && t.status !== 'approved' ? (
                  <TableFooter>
                    <TableRow>
                      <TableCell className="pl-4">Total</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {t.totals.requested}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {t.totals.dispatched}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {sum((l) => l.receivedQuantity)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {sum((l) => l.damagedQuantity)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {sum((l) => l.lostQuantity)}
                      </TableCell>
                      <TableCell className="pr-4 text-right tabular-nums">
                        {t.totals.inTransit}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                ) : null}
              </Table>
            </Card>
          )}

          {t.receipts.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Receipts</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="grid gap-3 text-sm">
                  {t.receipts.map((r, index) => {
                    const good = r.lines.reduce((s, l) => s + l.receivedQuantity, 0);
                    const damaged = r.lines.reduce((s, l) => s + l.damagedQuantity, 0);
                    return (
                      <li key={index}>
                        <span className="font-medium">
                          {good} received{damaged > 0 ? `, ${damaged} damaged` : ''}
                        </span>
                        <span className="text-muted-foreground">
                          {' '}
                          · {r.by.name}, {formatDateTime(r.at)}
                        </span>
                        {r.note ? <p className="mt-0.5">{r.note}</p> : null}
                      </li>
                    );
                  })}
                </ol>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <Card className="self-start">
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            <History entries={t.history} />
          </CardContent>
        </Card>
      </div>

      <FormDialog
        open={dialog === 'dispatch'}
        onOpenChange={close}
        title="Dispatch transfer"
        description={`Stock leaves ${t.fromWarehouse.code} now and is in transit until ${t.toWarehouse.code} receives it.`}
        wide
      >
        <DispatchForm transfer={t} onDone={() => setDialog(null)} />
      </FormDialog>
      <ReasonDialog
        open={dialog === 'reject'}
        onOpenChange={close}
        title="Reject transfer request"
        description="The request is closed with your reason."
        confirmLabel="Reject"
        destructive
        onConfirm={async (reason) => {
          await action.mutateAsync({ id: t.id, action: 'reject', body: { reason } });
          toast.success(`${t.number} rejected`);
        }}
      />
      <ReasonDialog
        open={dialog === 'cancel'}
        onOpenChange={close}
        title="Cancel transfer request"
        description="Nothing has moved yet, so no stock changes."
        confirmLabel="Cancel request"
        destructive
        onConfirm={async (reason) => {
          await action.mutateAsync({ id: t.id, action: 'cancel', body: { reason } });
          toast.success(`${t.number} cancelled`);
        }}
      />
      <ReasonDialog
        open={dialog === 'close'}
        onOpenChange={close}
        title="Close short"
        description={`The ${t.totals.inTransit} units still in transit are recorded as received at ${t.toWarehouse.code} and written off as lost in one adjustment.`}
        confirmLabel="Write off and close"
        destructive
        onConfirm={async (reason) => {
          await action.mutateAsync({ id: t.id, action: 'close', body: { reason } });
          toast.success(`${t.number} closed`);
        }}
      />
    </>
  );
}

function DispatchForm({ transfer: t, onDone }: { transfer: TransferDto; onDone: () => void }) {
  const { run, pending, errors, setErrors, formError } = useAction(t);
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(t.lines.map((l) => [l.id, String(l.quantity)])),
  );
  const [carrier, setCarrier] = useState('');
  const [reference, setReference] = useState('');

  const submit = async () => {
    const issues: Record<string, string> = {};
    t.lines.forEach((l, index) => {
      const v = quantities[l.id]!.trim();
      if (!WHOLE.test(v)) issues[`lines.${index}.quantity`] = 'Whole number';
      else if (Number(v) > l.quantity) issues[`lines.${index}.quantity`] = `At most ${l.quantity}`;
    });
    if (t.lines.every((l) => Number(quantities[l.id]) === 0)) {
      issues.lines = 'Dispatch at least one unit';
    }
    setErrors(issues);
    if (Object.keys(issues).length > 0) return;
    const ok = await run(
      {
        action: 'dispatch',
        body: {
          carrier: carrier.trim(),
          reference: reference.trim(),
          lines: t.lines.map((l) => ({ lineId: l.id, quantity: Number(quantities[l.id]) })),
        },
      },
      `${t.number} dispatched`,
    );
    if (ok) onDone();
  };

  return (
    <form
      id="dispatch-transfer"
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <FormAlert message={formError} />
      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-3">Product</TableHead>
              <TableHead className="text-right">Requested</TableHead>
              <TableHead className="w-28 pr-3">Dispatch</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {t.lines.map((l, index) => {
              const error = errors[`lines.${index}.quantity`];
              return (
                <TableRow key={l.id} className="align-top">
                  <TableCell className="pl-3">
                    <ProductCell line={l} />
                  </TableCell>
                  <TableCell className="pt-4 text-right tabular-nums">{l.quantity}</TableCell>
                  <TableCell className="pr-3">
                    <Input
                      aria-label={`Quantity to dispatch for ${l.sku}`}
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
      </div>
      {errors.lines ? <p className="text-destructive text-xs">{errors.lines}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="trf-carrier" label="Carrier" error={errors.carrier}>
          <Input
            {...fieldA11y('trf-carrier', errors.carrier)}
            value={carrier}
            maxLength={100}
            placeholder="Optional"
            onChange={(event) => setCarrier(event.target.value)}
          />
        </FormField>
        <FormField id="trf-reference" label="Reference" error={errors.reference}>
          <Input
            {...fieldA11y('trf-reference', errors.reference)}
            value={reference}
            maxLength={100}
            placeholder="Optional"
            onChange={(event) => setReference(event.target.value)}
          />
        </FormField>
      </div>
      <DialogActions
        formId="dispatch-transfer"
        submitLabel="Dispatch"
        pending={pending}
        onCancel={onDone}
      />
    </form>
  );
}

function ReceiveForm({ transfer: t }: { transfer: TransferDto }) {
  const { run, pending, errors, setErrors, formError } = useAction(t);
  const open = t.lines.filter((l) => l.inTransitQuantity > 0);
  const [values, setValues] = useState<Record<string, { good: string; damaged: string }>>(() =>
    Object.fromEntries(open.map((l) => [l.id, { good: '', damaged: '' }])),
  );
  const [note, setNote] = useState('');
  const num = (v: string) => (WHOLE.test(v.trim()) ? Number(v) : 0);

  const submit = async () => {
    const issues: Record<string, string> = {};
    open.forEach((l, index) => {
      const v = values[l.id]!;
      for (const field of ['good', 'damaged'] as const) {
        if (v[field].trim() !== '' && !WHOLE.test(v[field].trim())) {
          issues[`lines.${index}.receivedQuantity`] = 'Whole numbers only';
        }
      }
      if (num(v.good) + num(v.damaged) > l.inTransitQuantity) {
        issues[`lines.${index}.receivedQuantity`] = `Only ${l.inTransitQuantity} in transit`;
      }
    });
    if (open.every((l) => num(values[l.id]!.good) + num(values[l.id]!.damaged) === 0)) {
      issues.lines = 'Enter what arrived for at least one product';
    }
    setErrors(issues);
    if (Object.keys(issues).length > 0) return;
    const ok = await run(
      {
        action: 'receive',
        body: {
          note: note.trim(),
          lines: open.map((l) => ({
            lineId: l.id,
            receivedQuantity: num(values[l.id]!.good),
            damagedQuantity: num(values[l.id]!.damaged),
          })),
        },
      },
      'Receipt recorded',
    );
    if (ok) {
      setValues(Object.fromEntries(open.map((l) => [l.id, { good: '', damaged: '' }])));
      setNote('');
    }
  };

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <FormAlert message={formError} />
      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Product</TableHead>
              <TableHead className="text-right">Dispatched</TableHead>
              <TableHead className="text-right">Received so far</TableHead>
              <TableHead className="text-right">In transit</TableHead>
              <TableHead className="w-28">Received</TableHead>
              <TableHead className="w-28 pr-4">Damaged</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {open.map((l, index) => {
              const error = errors[`lines.${index}.receivedQuantity`];
              const input = (field: 'good' | 'damaged', label: string) => (
                <Input
                  aria-label={`${label} for ${l.sku}`}
                  aria-invalid={error ? true : undefined}
                  inputMode="numeric"
                  value={values[l.id]![field]}
                  onChange={(event) =>
                    setValues((current) => ({
                      ...current,
                      [l.id]: { ...current[l.id]!, [field]: event.target.value },
                    }))
                  }
                />
              );
              return (
                <TableRow key={l.id} className="align-top">
                  <TableCell className="pl-4">
                    <ProductCell line={l} />
                  </TableCell>
                  <TableCell className="pt-4 text-right tabular-nums">
                    {l.dispatchedQuantity}
                  </TableCell>
                  <TableCell className="pt-4 text-right tabular-nums">
                    {l.receivedQuantity + l.damagedQuantity}
                  </TableCell>
                  <TableCell className="pt-4 text-right font-medium tabular-nums">
                    <button
                      type="button"
                      className="hover:underline"
                      aria-label={`Receive all ${l.inTransitQuantity} ${l.sku}`}
                      onClick={() =>
                        setValues((current) => ({
                          ...current,
                          [l.id]: { good: String(l.inTransitQuantity), damaged: '' },
                        }))
                      }
                    >
                      {l.inTransitQuantity}
                    </button>
                  </TableCell>
                  <TableCell>
                    {input('good', 'Received')}
                    {error ? <p className="text-destructive mt-1 text-xs">{error}</p> : null}
                  </TableCell>
                  <TableCell className="pr-4">{input('damaged', 'Damaged')}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className="grid gap-3 border-t px-4 py-3">
          <FormField id="trf-receipt-note" label="Note" error={errors.note}>
            <Input
              {...fieldA11y('trf-receipt-note', errors.note)}
              value={note}
              maxLength={500}
              placeholder="Optional"
              onChange={(event) => setNote(event.target.value)}
            />
          </FormField>
          <p className="text-muted-foreground text-xs">
            Damaged units go to {t.toWarehouse.code}'s quarantine, not usable stock.
            {errors.lines ? <span className="text-destructive ml-2">{errors.lines}</span> : null}
          </p>
        </div>
      </Card>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Record receipt
        </Button>
      </div>
    </form>
  );
}

function ProductCell({ line }: { line: TransferDto['lines'][number] }) {
  return (
    <>
      <Link to={`/products/${line.productId}`} className="font-medium hover:underline">
        {line.name}
      </Link>
      <div className="text-muted-foreground font-mono text-xs">
        {line.sku} · {line.unit}
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
