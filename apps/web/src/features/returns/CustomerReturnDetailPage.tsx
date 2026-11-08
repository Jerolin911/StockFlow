import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { RETURN_REASON_LABELS, type CustomerReturnDto } from '@stockflow/shared';
import { BackLink } from '@/components/BackLink';
import { History, ReasonDialog } from '@/components/document-parts';
import { FormField, fieldA11y } from '@/components/FormField';
import { FormAlert } from '@/components/form-parts';
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
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usePermission } from '@/features/auth/auth-context';
import { useMoney } from '@/features/settings/api';
import { ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { useCustomerReturn, useCustomerReturnAction, type CustomerReturnAction } from './api';
import { CustomerReturnStatusBadge } from './components';

export function CustomerReturnDetailPage() {
  const { id } = useParams<{ id: string }>();
  const ret = useCustomerReturn(id);
  if (ret.isError && ret.error instanceof ApiError && ret.error.status === 404)
    return <NotFoundPage />;
  if (!ret.data) {
    return ret.isError ? (
      <p className="text-destructive text-sm">Couldn't load this return.</p>
    ) : (
      <Skeleton className="h-64 w-full" />
    );
  }
  return <Detail key={`${ret.data.id}:${ret.data.status}`} ret={ret.data} />;
}

function useAction(ret: CustomerReturnDto) {
  const mutation = useCustomerReturnAction();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const run = async (action: CustomerReturnAction, success: string) => {
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      await mutation.mutateAsync({ id: ret.id, ...action });
      toast.success(success);
    } catch (error) {
      if (error instanceof ApiError && error.details.length > 0) {
        setErrors(Object.fromEntries(error.details.map((d) => [d.path, d.message])));
      }
      setFormError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    } finally {
      setPending(false);
    }
  };
  return { run, pending, errors, setErrors, formError };
}

type Dialog = 'reject' | 'cancel' | null;

function Detail({ ret: r }: { ret: CustomerReturnDto }) {
  const money = useMoney();
  const canWrite = usePermission('customerReturns:write');
  const canProcess = usePermission('returns:process');
  const action = useCustomerReturnAction();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [approving, setApproving] = useState(false);

  const buttons: ReactNode[] = [];
  if ((r.status === 'requested' || r.status === 'approved') && canWrite) {
    buttons.push(
      <Button key="cancel" variant="ghost" onClick={() => setDialog('cancel')}>
        Cancel return
      </Button>,
    );
  }
  if (r.status === 'requested' && canWrite) {
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

  return (
    <>
      <BackLink to="/customer-returns" label="Customer returns" />
      <PageHeader
        title={r.number}
        description={<CustomerReturnStatusBadge status={r.status} />}
        actions={buttons.length > 0 ? buttons : null}
      />
      <div className="grid gap-6 2xl:grid-cols-3">
        <div className="grid min-w-0 gap-6 2xl:col-span-2">
          <Card>
            <CardContent>
              <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <Meta label="Sales order">
                  <Link
                    to={`/sales-orders/${r.salesOrder.id}`}
                    className="font-mono hover:underline"
                  >
                    {r.salesOrder.number}
                  </Link>
                </Meta>
                <Meta label="Customer">{r.customer.name}</Meta>
                <Meta label="Return to">
                  {r.warehouse.code} — {r.warehouse.name}
                </Meta>
                <Meta label="Reason">{RETURN_REASON_LABELS[r.reason]}</Meta>
                <Meta label="Raised by">
                  {r.requestedBy.name}, {formatDateTime(r.createdAt)}
                </Meta>
                <Meta label="Approved by">{r.approvedBy?.name ?? '—'}</Meta>
                {r.receivedBy ? (
                  <Meta label="Received">
                    {r.receivedBy.name}, {formatDateTime(r.receivedAt)}
                  </Meta>
                ) : null}
                {r.inspectedBy ? (
                  <Meta label="Inspected">
                    {r.inspectedBy.name}, {formatDateTime(r.inspectedAt)}
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

          {r.status === 'approved' && canProcess ? (
            <ReceiveForm ret={r} />
          ) : r.status === 'received' && canProcess ? (
            <InspectForm ret={r} />
          ) : (
            <Card className="gap-0 overflow-hidden py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Product</TableHead>
                    <TableHead className="text-right">Requested</TableHead>
                    <TableHead className="text-right">Received</TableHead>
                    <TableHead className="text-right">Restocked</TableHead>
                    <TableHead className="text-right">Quarantined</TableHead>
                    <TableHead className="hidden pr-4 text-right lg:table-cell">
                      Unit cost
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="pl-4">
                        <ProductCell line={l} />
                        {l.note ? (
                          <div className="text-muted-foreground text-xs">{l.note}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{l.quantity}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {l.receivedQuantity}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {l.restockedQuantity}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {l.quarantinedQuantity}
                      </TableCell>
                      <TableCell className="hidden pr-4 text-right tabular-nums lg:table-cell">
                        {money(l.unitCost)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {r.status === 'completed' && r.totals.quarantined > 0 ? (
                <p className="text-muted-foreground border-t px-4 py-3 text-sm">
                  {r.totals.quarantined} units stay in {r.warehouse.code}'s{' '}
                  <Link to="/stock/quarantine" className="underline">
                    quarantine
                  </Link>{' '}
                  until released, written off or returned to the supplier.
                </p>
              ) : null}
            </Card>
          )}
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

      <ReasonDialog
        open={dialog === 'reject'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Reject return"
        description="The units become returnable again on the order."
        confirmLabel="Reject"
        destructive
        onConfirm={async (reason) => {
          await action.mutateAsync({ id: r.id, action: 'reject', body: { reason } });
          toast.success(`${r.number} rejected`);
        }}
      />
      <ReasonDialog
        open={dialog === 'cancel'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Cancel return"
        description="Nothing has come back yet, so no stock changes."
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

const WHOLE = /^\d{1,9}$/;
const num = (v: string) => (WHOLE.test(v.trim()) ? Number(v) : 0);

function ReceiveForm({ ret: r }: { ret: CustomerReturnDto }) {
  const { run, pending, errors, setErrors, formError } = useAction(r);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(r.lines.map((l) => [l.id, String(l.quantity)])),
  );
  const [note, setNote] = useState('');

  const submit = async () => {
    const issues: Record<string, string> = {};
    r.lines.forEach((l, index) => {
      const v = values[l.id]!.trim();
      if (!WHOLE.test(v)) issues[`lines.${index}.receivedQuantity`] = 'Whole number';
      else if (Number(v) > l.quantity)
        issues[`lines.${index}.receivedQuantity`] = `At most ${l.quantity}`;
    });
    if (r.lines.every((l) => num(values[l.id]!) === 0)) issues.lines = 'Nothing was received';
    setErrors(issues);
    if (Object.keys(issues).length > 0) return;
    await run(
      {
        action: 'receive',
        body: {
          note: note.trim(),
          lines: r.lines.map((l) => ({ lineId: l.id, receivedQuantity: num(values[l.id]!) })),
        },
      },
      'Received into quarantine',
    );
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
        <p className="text-muted-foreground border-b px-4 py-3 text-sm">
          Received goods go to {r.warehouse.code}'s quarantine until inspected. Units not sent back
          become returnable again on the order.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Product</TableHead>
              <TableHead className="text-right">Approved</TableHead>
              <TableHead className="w-32 pr-4">Received</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {r.lines.map((l, index) => {
              const error = errors[`lines.${index}.receivedQuantity`];
              return (
                <TableRow key={l.id} className="align-top">
                  <TableCell className="pl-4">
                    <ProductCell line={l} />
                  </TableCell>
                  <TableCell className="pt-4 text-right tabular-nums">{l.quantity}</TableCell>
                  <TableCell className="pr-4">
                    <Input
                      aria-label={`Received quantity for ${l.sku}`}
                      aria-invalid={error ? true : undefined}
                      inputMode="numeric"
                      value={values[l.id]}
                      onChange={(event) =>
                        setValues((current) => ({ ...current, [l.id]: event.target.value }))
                      }
                    />
                    {error ? <p className="text-destructive mt-1 text-xs">{error}</p> : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className="border-t px-4 py-3">
          <FormField id="rma-receive-note" label="Note" error={errors.note}>
            <Input
              {...fieldA11y('rma-receive-note', errors.note)}
              value={note}
              maxLength={500}
              placeholder="Optional"
              onChange={(event) => setNote(event.target.value)}
            />
          </FormField>
          {errors.lines ? <p className="text-destructive mt-2 text-xs">{errors.lines}</p> : null}
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

function InspectForm({ ret: r }: { ret: CustomerReturnDto }) {
  const { run, pending, errors, setErrors, formError } = useAction(r);
  const lines = r.lines.filter((l) => l.receivedQuantity > 0);
  const [values, setValues] = useState<Record<string, { restock: string; note: string }>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, { restock: String(l.receivedQuantity), note: '' }])),
  );

  const submit = async () => {
    const issues: Record<string, string> = {};
    lines.forEach((l) => {
      const v = values[l.id]!.restock.trim();
      if (!WHOLE.test(v)) issues[l.id] = 'Whole number';
      else if (Number(v) > l.receivedQuantity) issues[l.id] = `At most ${l.receivedQuantity}`;
    });
    setErrors(issues);
    if (Object.keys(issues).length > 0) return;
    const restocked = lines.reduce((s, l) => s + num(values[l.id]!.restock), 0);
    await run(
      {
        action: 'inspect',
        body: {
          lines: lines.map((l) => {
            const restock = num(values[l.id]!.restock);
            return {
              lineId: l.id,
              restockQuantity: restock,
              quarantineQuantity: l.receivedQuantity - restock,
              note: values[l.id]!.note.trim(),
            };
          }),
        },
      },
      `${restocked} units restocked`,
    );
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
        <p className="text-muted-foreground border-b px-4 py-3 text-sm">
          Restock what can be sold again. Everything else stays isolated in quarantine.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Product</TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead className="w-28">Restock</TableHead>
              <TableHead className="text-right">Keep in quarantine</TableHead>
              <TableHead className="min-w-44 pr-4">Condition note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l) => {
              const restock = num(values[l.id]!.restock);
              const error = errors[l.id];
              return (
                <TableRow key={l.id} className="align-top">
                  <TableCell className="pl-4">
                    <ProductCell line={l} />
                  </TableCell>
                  <TableCell className="pt-4 text-right tabular-nums">
                    {l.receivedQuantity}
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={`Quantity to restock for ${l.sku}`}
                      aria-invalid={error ? true : undefined}
                      inputMode="numeric"
                      value={values[l.id]!.restock}
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          [l.id]: { ...current[l.id]!, restock: event.target.value },
                        }))
                      }
                    />
                    {error ? <p className="text-destructive mt-1 text-xs">{error}</p> : null}
                  </TableCell>
                  <TableCell className="pt-4 text-right font-medium text-amber-800 tabular-nums">
                    {Math.max(l.receivedQuantity - restock, 0)}
                  </TableCell>
                  <TableCell className="pr-4">
                    <Input
                      aria-label={`Condition note for ${l.sku}`}
                      value={values[l.id]!.note}
                      maxLength={200}
                      placeholder="e.g. cracked casing"
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          [l.id]: { ...current[l.id]!, note: event.target.value },
                        }))
                      }
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Complete inspection
        </Button>
      </div>
    </form>
  );
}

function ProductCell({ line }: { line: CustomerReturnDto['lines'][number] }) {
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
