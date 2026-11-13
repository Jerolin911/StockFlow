import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { Check, Loader2, PackageOpen, Send, Truck } from 'lucide-react';
import { toast } from 'sonner';
import {
  TRACKING_EVENT_LABELS,
  TRACKING_EVENT_TYPES,
  type ShipmentDto,
  type TrackingEventType,
} from '@stockflow/shared';
import { BackLink } from '@/components/BackLink';
import { History, ReasonDialog } from '@/components/document-parts';
import { FormField, fieldA11y } from '@/components/FormField';
import { DialogActions, FormAlert, FormDialog } from '@/components/form-parts';
import { PageHeader } from '@/components/PageHeader';
import { NotFoundPage } from '@/components/StatusPages';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { usePermission } from '@/features/auth/auth-context';
import { ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useShipment, useShipmentStep, type ShipmentStep } from './api';
import { ShipmentStatusBadge, formatWeight } from './components';

export function ShipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const shipment = useShipment(id);
  if (shipment.isError && shipment.error instanceof ApiError && shipment.error.status === 404)
    return <NotFoundPage />;
  if (!shipment.data) {
    return shipment.isError ? (
      <p className="text-destructive text-sm">Couldn't load this shipment.</p>
    ) : (
      <Skeleton className="h-64 w-full" />
    );
  }
  return <Detail key={shipment.data.id} shipment={shipment.data} />;
}

/** Runs a shipment step, mapping server field errors for the form that sent it. */
function useStep(shipment: ShipmentDto) {
  const mutation = useShipmentStep();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const run = async (step: ShipmentStep, success: string) => {
    setPending(true);
    setErrors({});
    setFormError(null);
    try {
      await mutation.mutateAsync({ id: shipment.id, ...step });
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

type Dialog = 'pack' | 'dispatch' | 'tracking' | 'cancel' | null;

const units = (n: number) => `${n} unit${n === 1 ? '' : 's'}`;

function Detail({ shipment: s }: { shipment: ShipmentDto }) {
  const canShip = usePermission('shipments:create');
  const step = useShipmentStep();
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = (next: boolean) => !next && setDialog(null);
  const preDispatch = ['picking', 'picked', 'packed'].includes(s.status);
  const moving = s.status === 'dispatched' || s.status === 'in_transit';

  const buttons: ReactNode[] = [];
  if (canShip && preDispatch) {
    buttons.push(
      <Button key="cancel" variant="ghost" onClick={() => setDialog('cancel')}>
        Cancel shipment
      </Button>,
    );
  }
  if (canShip && s.status === 'picked') {
    buttons.push(
      <Button key="pack" onClick={() => setDialog('pack')}>
        <PackageOpen />
        Record packing
      </Button>,
    );
  }
  if (canShip && s.status === 'packed') {
    buttons.push(
      <Button key="dispatch" onClick={() => setDialog('dispatch')}>
        <Send />
        Dispatch
      </Button>,
    );
  }
  if (canShip && moving) {
    buttons.push(
      <Button key="tracking" onClick={() => setDialog('tracking')}>
        <Truck />
        Add tracking update
      </Button>,
    );
  }

  return (
    <>
      <BackLink to="/shipments" label="Shipments" />
      <PageHeader
        title={s.number}
        description={<ShipmentStatusBadge status={s.status} />}
        actions={buttons.length > 0 ? buttons : null}
      />

      <Progress shipment={s} />

      <div className="grid gap-6 2xl:grid-cols-3">
        <div className="grid min-w-0 gap-6 2xl:col-span-2">
          <Card>
            <CardContent>
              <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <Meta label="Sales order">
                  <Link
                    to={`/sales-orders/${s.salesOrder.id}`}
                    className="font-mono hover:underline"
                  >
                    {s.salesOrder.number}
                  </Link>
                </Meta>
                <Meta label="Customer">{s.customer.name}</Meta>
                <Meta label="Ship from">
                  {s.warehouse.code} — {s.warehouse.name}
                </Meta>
                <div className="sm:col-span-2">
                  <Meta label="Ship to">
                    <span className="whitespace-pre-line">
                      {s.customerErased
                        ? 'Erased at the customer’s request'
                        : s.shippingAddress || '—'}
                    </span>
                  </Meta>
                </div>
                <Meta label="Packages">
                  {s.packageCount ?? '—'}
                  {s.weightGrams !== null ? `, ${formatWeight(s.weightGrams)}` : ''}
                </Meta>
                <Meta label="Carrier">{s.carrier || '—'}</Meta>
                <Meta label="Tracking number">
                  <span className="font-mono">{s.trackingNumber || '—'}</span>
                </Meta>
                {s.receivedBy ? <Meta label="Received by">{s.receivedBy}</Meta> : null}
                {s.shortPickReason ? <Meta label="Short pick">{s.shortPickReason}</Meta> : null}
                {s.cancelReason ? <Meta label="Cancelled because">{s.cancelReason}</Meta> : null}
                {s.notes ? (
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Meta label="Notes">{s.notes}</Meta>
                  </div>
                ) : null}
              </dl>
            </CardContent>
          </Card>

          {s.status === 'picking' && canShip ? (
            <PickForm shipment={s} />
          ) : (
            <Card className="gap-0 overflow-hidden py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Product</TableHead>
                    <TableHead className="text-right">Requested</TableHead>
                    <TableHead className="pr-4 text-right">
                      {moving || s.status === 'delivered' ? 'Shipped' : 'Picked'}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="pl-4">
                        <ProductCell line={l} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{l.quantity}</TableCell>
                      <TableCell
                        className={cn(
                          'pr-4 text-right tabular-nums',
                          l.pickedQuantity !== null &&
                            l.pickedQuantity < l.quantity &&
                            'text-amber-800',
                        )}
                      >
                        {l.pickedQuantity ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="pl-4">Total</TableCell>
                    <TableCell className="text-right tabular-nums">{s.totals.requested}</TableCell>
                    <TableCell className="pr-4 text-right tabular-nums">
                      {s.totals.picked ?? '—'}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </Card>
          )}

          {s.tracking.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Tracking</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="grid gap-4">
                  {[...s.tracking].reverse().map((t, index) => (
                    <li key={index} className="relative pl-5">
                      <span
                        className={cn(
                          'absolute top-1.5 left-0 size-2 rounded-full',
                          t.type === 'delivered'
                            ? 'bg-emerald-600'
                            : t.type === 'delivery_attempted'
                              ? 'bg-amber-500'
                              : 'bg-primary/70',
                        )}
                        aria-hidden
                      />
                      <p className="text-sm font-medium">
                        {TRACKING_EVENT_LABELS[t.type]}
                        {t.location ? (
                          <span className="text-muted-foreground font-normal"> · {t.location}</span>
                        ) : null}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {formatDateTime(t.at)} · recorded by {t.by.name}
                      </p>
                      {t.note ? <p className="mt-1 text-sm">{t.note}</p> : null}
                    </li>
                  ))}
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
            <History entries={s.history} />
          </CardContent>
        </Card>
      </div>

      <FormDialog
        open={dialog === 'pack'}
        onOpenChange={close}
        title="Record packing"
        description={`${units(s.totals.picked ?? 0)} picked for ${s.customer.name}.`}
      >
        <PackForm shipment={s} onDone={() => setDialog(null)} />
      </FormDialog>
      <FormDialog
        open={dialog === 'dispatch'}
        onOpenChange={close}
        title="Dispatch shipment"
        description={`${units(s.totals.picked ?? 0)} leave ${s.warehouse.code} and are taken off on-hand stock. This can't be undone.`}
      >
        <DispatchForm shipment={s} onDone={() => setDialog(null)} />
      </FormDialog>
      <FormDialog open={dialog === 'tracking'} onOpenChange={close} title="Add tracking update">
        <TrackingForm shipment={s} onDone={() => setDialog(null)} />
      </FormDialog>
      <ReasonDialog
        open={dialog === 'cancel'}
        onOpenChange={close}
        title="Cancel shipment"
        description="Its units go back to the order, still reserved, so they can go on another pick list."
        confirmLabel="Cancel shipment"
        destructive
        onConfirm={async (reason) => {
          await step.mutateAsync({ id: s.id, step: 'cancel', body: { reason } });
          toast.success(`${s.number} cancelled`);
        }}
      />
    </>
  );
}

const STAGES: { label: string; at: (s: ShipmentDto) => string | null }[] = [
  { label: 'Pick list created', at: (s) => s.createdAt },
  { label: 'Picked', at: (s) => s.pickedAt },
  { label: 'Packed', at: (s) => s.packedAt },
  { label: 'Dispatched', at: (s) => s.dispatchedAt },
  { label: 'Delivered', at: (s) => s.deliveredAt },
];

function Progress({ shipment }: { shipment: ShipmentDto }) {
  if (shipment.status === 'cancelled') return null;
  return (
    <ol className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
      {STAGES.map((stage) => {
        const at = stage.at(shipment);
        return (
          <li
            key={stage.label}
            className={cn(
              'rounded-md border px-3 py-2 text-sm',
              at ? 'border-emerald-200 bg-emerald-50' : 'text-muted-foreground',
            )}
          >
            <div className="flex items-center gap-1.5 font-medium">
              {at ? <Check className="size-4 text-emerald-700" aria-hidden /> : null}
              {stage.label}
            </div>
            <div className="text-xs">{at ? formatDateTime(at) : 'Not yet'}</div>
          </li>
        );
      })}
    </ol>
  );
}

const WHOLE = /^\d{1,9}$/;

function PickForm({ shipment: s }: { shipment: ShipmentDto }) {
  const { run, pending, errors, setErrors, formError } = useStep(s);
  const [picked, setPicked] = useState<Record<string, string>>(() =>
    Object.fromEntries(s.lines.map((l) => [l.id, String(l.quantity)])),
  );
  const [reason, setReason] = useState('');
  const value = (id: string) => (WHOLE.test(picked[id]!.trim()) ? Number(picked[id]) : null);
  const total = s.lines.reduce((sum, l) => sum + (value(l.id) ?? 0), 0);
  const short = s.totals.requested - total;

  const submit = async () => {
    const issues: Record<string, string> = {};
    s.lines.forEach((l, index) => {
      const v = value(l.id);
      if (v === null) issues[`lines.${index}.pickedQuantity`] = 'Whole number';
      else if (v > l.quantity) issues[`lines.${index}.pickedQuantity`] = `At most ${l.quantity}`;
    });
    if (short > 0 && !reason.trim())
      issues.shortPickReason = 'Say why the full quantity wasn’t picked';
    setErrors(issues);
    if (Object.keys(issues).length > 0) return;
    await run(
      {
        step: 'pick',
        body: {
          shortPickReason: short > 0 ? reason.trim() : '',
          lines: s.lines.map((l) => ({ lineId: l.id, pickedQuantity: value(l.id)! })),
        },
      },
      short > 0 ? `Picked ${total}; ${short} returned to the order` : `Picked ${total}`,
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Product</TableHead>
              <TableHead className="text-right">To pick</TableHead>
              <TableHead className="w-32 pr-4">Picked</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {s.lines.map((l, index) => {
              const error = errors[`lines.${index}.pickedQuantity`];
              return (
                <TableRow key={l.id} className="align-top">
                  <TableCell className="pl-4">
                    <ProductCell line={l} />
                  </TableCell>
                  <TableCell className="pt-4 text-right tabular-nums">{l.quantity}</TableCell>
                  <TableCell className="pr-4">
                    <Input
                      aria-label={`Picked quantity for ${l.sku}`}
                      aria-invalid={error ? true : undefined}
                      inputMode="numeric"
                      value={picked[l.id]}
                      onChange={(event) =>
                        setPicked((current) => ({ ...current, [l.id]: event.target.value }))
                      }
                    />
                    {error ? <p className="text-destructive mt-1 text-xs">{error}</p> : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {short > 0 ? (
          <div className="border-t px-4 py-3">
            <FormField
              id="short-reason"
              label={short === 1 ? 'Why is 1 unit short?' : `Why are ${short} units short?`}
              error={errors.shortPickReason}
              hint="The missing units go back to the order and stay reserved."
            >
              <Input
                {...fieldA11y('short-reason', errors.shortPickReason, 'hint')}
                value={reason}
                maxLength={500}
                placeholder="e.g. damaged on the shelf"
                onChange={(event) => setReason(event.target.value)}
              />
            </FormField>
          </div>
        ) : null}
      </Card>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Confirm picking
        </Button>
      </div>
    </form>
  );
}

function PackForm({ shipment: s, onDone }: { shipment: ShipmentDto; onDone: () => void }) {
  const { run, pending, errors, setErrors, formError } = useStep(s);
  const [packages, setPackages] = useState('1');
  const [weight, setWeight] = useState('');
  const [notes, setNotes] = useState('');

  const submit = async () => {
    const issues: Record<string, string> = {};
    if (!WHOLE.test(packages.trim()) || Number(packages) < 1) issues.packageCount = 'At least 1';
    const kg = weight.trim() === '' ? null : Number(weight.replace(',', '.'));
    if (kg !== null && (!Number.isFinite(kg) || kg <= 0))
      issues.weightGrams = 'Enter a weight in kg';
    setErrors(issues);
    if (Object.keys(issues).length > 0) return;
    const ok = await run(
      {
        step: 'pack',
        body: {
          packageCount: Number(packages),
          weightGrams: kg === null ? null : Math.round(kg * 1000),
          notes: notes.trim(),
        },
      },
      `${s.number} packed`,
    );
    if (ok) onDone();
  };

  return (
    <form
      id="pack-form"
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <FormAlert message={formError} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="pack-count" label="Packages" error={errors.packageCount}>
          <Input
            {...fieldA11y('pack-count', errors.packageCount)}
            inputMode="numeric"
            value={packages}
            onChange={(event) => setPackages(event.target.value)}
            autoFocus
          />
        </FormField>
        <FormField id="pack-weight" label="Total weight (kg)" error={errors.weightGrams}>
          <Input
            {...fieldA11y('pack-weight', errors.weightGrams)}
            inputMode="decimal"
            placeholder="Optional"
            value={weight}
            onChange={(event) => setWeight(event.target.value)}
          />
        </FormField>
      </div>
      <FormField id="pack-notes" label="Notes" error={errors.notes}>
        <Textarea
          {...fieldA11y('pack-notes', errors.notes)}
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </FormField>
      <DialogActions
        formId="pack-form"
        submitLabel="Mark as packed"
        pending={pending}
        onCancel={onDone}
      />
    </form>
  );
}

function DispatchForm({ shipment: s, onDone }: { shipment: ShipmentDto; onDone: () => void }) {
  const { run, pending, errors, setErrors, formError } = useStep(s);
  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState('');

  const submit = async () => {
    if (!carrier.trim()) {
      setErrors({ carrier: 'Enter the carrier' });
      return;
    }
    const ok = await run(
      { step: 'dispatch', body: { carrier: carrier.trim(), trackingNumber: tracking.trim() } },
      `${s.number} dispatched`,
    );
    if (ok) onDone();
  };

  return (
    <form
      id="dispatch-form"
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <FormAlert message={formError} />
      <FormField id="dispatch-carrier" label="Carrier" error={errors.carrier}>
        <Input
          {...fieldA11y('dispatch-carrier', errors.carrier)}
          value={carrier}
          maxLength={100}
          placeholder="e.g. own van, Northline Freight"
          onChange={(event) => setCarrier(event.target.value)}
          autoFocus
        />
      </FormField>
      <FormField id="dispatch-tracking" label="Tracking number" error={errors.trackingNumber}>
        <Input
          {...fieldA11y('dispatch-tracking', errors.trackingNumber)}
          value={tracking}
          maxLength={100}
          placeholder="Optional"
          onChange={(event) => setTracking(event.target.value)}
        />
      </FormField>
      <DialogActions
        formId="dispatch-form"
        submitLabel="Dispatch"
        pending={pending}
        onCancel={onDone}
      />
    </form>
  );
}

/** Current local time in the format a datetime-local input expects. */
function nowLocal() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function TrackingForm({ shipment: s, onDone }: { shipment: ShipmentDto; onDone: () => void }) {
  const { run, pending, errors, setErrors, formError } = useStep(s);
  const [type, setType] = useState<TrackingEventType>('in_transit');
  const [openedAt] = useState(nowLocal);
  const [at, setAt] = useState(openedAt);
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [receivedBy, setReceivedBy] = useState('');

  const submit = async () => {
    const issues: Record<string, string> = {};
    if (!at) issues.at = 'Enter the date and time';
    if (type === 'delivery_attempted' && !note.trim()) issues.note = 'Say why the delivery failed';
    if (type === 'delivered' && !receivedBy.trim()) issues.receivedBy = 'Enter who received it';
    setErrors(issues);
    if (Object.keys(issues).length > 0) return;
    const ok = await run(
      {
        step: 'tracking',
        body: {
          type,
          // Unchanged means "now"; the server stamps it to the second.
          ...(at === openedAt ? {} : { at: new Date(at).toISOString() }),
          location: location.trim(),
          note: note.trim(),
          receivedBy: type === 'delivered' ? receivedBy.trim() : '',
        },
      },
      type === 'delivered' ? `${s.number} delivered` : 'Tracking updated',
    );
    if (ok) onDone();
  };

  return (
    <form
      id="tracking-form"
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <FormAlert message={formError} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="tracking-type" label="Status" error={errors.type}>
          <Select value={type} onValueChange={(v) => setType(v as TrackingEventType)}>
            <SelectTrigger {...fieldA11y('tracking-type', errors.type)} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRACKING_EVENT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {TRACKING_EVENT_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField id="tracking-at" label="When" error={errors.at}>
          <Input
            {...fieldA11y('tracking-at', errors.at)}
            type="datetime-local"
            max={nowLocal()}
            value={at}
            onChange={(event) => setAt(event.target.value)}
          />
        </FormField>
      </div>
      {type === 'delivered' ? (
        <FormField id="tracking-received" label="Received by" error={errors.receivedBy}>
          <Input
            {...fieldA11y('tracking-received', errors.receivedBy)}
            value={receivedBy}
            maxLength={100}
            onChange={(event) => setReceivedBy(event.target.value)}
          />
        </FormField>
      ) : null}
      <FormField id="tracking-location" label="Location" error={errors.location}>
        <Input
          {...fieldA11y('tracking-location', errors.location)}
          value={location}
          maxLength={200}
          placeholder="Optional"
          onChange={(event) => setLocation(event.target.value)}
        />
      </FormField>
      <FormField id="tracking-note" label="Note" error={errors.note}>
        <Textarea
          {...fieldA11y('tracking-note', errors.note)}
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </FormField>
      <DialogActions
        formId="tracking-form"
        submitLabel={type === 'delivered' ? 'Confirm delivery' : 'Add update'}
        pending={pending}
        onCancel={onDone}
      />
    </form>
  );
}

function ProductCell({ line }: { line: ShipmentDto['lines'][number] }) {
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
