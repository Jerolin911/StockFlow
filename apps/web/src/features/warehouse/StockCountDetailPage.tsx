import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  ADJUSTMENT_REASON_LABELS,
  VARIANCE_REASONS,
  type StockCountDto,
  type VarianceReason,
} from '@stockflow/shared';
import { BackLink } from '@/components/BackLink';
import { History, ReasonDialog } from '@/components/document-parts';
import { FormAlert } from '@/components/form-parts';
import { PageHeader } from '@/components/PageHeader';
import { NotFoundPage } from '@/components/StatusPages';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usePermission } from '@/features/auth/auth-context';
import { ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useRecordCounts, useStockCount, useStockCountAction } from './api';
import { StockCountStatusBadge } from './components';

export function StockCountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const count = useStockCount(id);
  if (count.isError && count.error instanceof ApiError && count.error.status === 404)
    return <NotFoundPage />;
  if (!count.data) {
    return count.isError ? (
      <p className="text-destructive text-sm">Couldn't load this count.</p>
    ) : (
      <Skeleton className="h-64 w-full" />
    );
  }
  return <Detail key={`${count.data.id}:${count.data.status}`} count={count.data} />;
}

function Detail({ count: c }: { count: StockCountDto }) {
  const canCount = usePermission('stock:count');
  const canPost = usePermission('stock:adjust');
  const action = useStockCountAction();
  const [cancelling, setCancelling] = useState(false);
  const [reopening, setReopening] = useState(false);
  const open = c.status === 'counting' || c.status === 'submitted';

  const buttons: ReactNode[] = [];
  if (open && canCount) {
    buttons.push(
      <Button key="cancel" variant="ghost" onClick={() => setCancelling(true)}>
        Cancel count
      </Button>,
    );
  }
  if (c.status === 'submitted' && canCount) {
    buttons.push(
      <Button
        key="reopen"
        variant="outline"
        disabled={reopening}
        onClick={async () => {
          setReopening(true);
          try {
            await action.mutateAsync({ id: c.id, action: 'reopen' });
            toast.success('Reopened for counting');
          } catch (error) {
            toast.error(error instanceof ApiError ? error.message : 'Something went wrong');
          } finally {
            setReopening(false);
          }
        }}
      >
        Reopen for counting
      </Button>,
    );
  }

  return (
    <>
      <BackLink to="/stock/counts" label="Stock counts" />
      <PageHeader
        title={c.number}
        description={<StockCountStatusBadge status={c.status} />}
        actions={buttons.length > 0 ? buttons : null}
      />
      <div className="grid gap-6 2xl:grid-cols-3">
        <div className="grid min-w-0 gap-6 2xl:col-span-2">
          <Card>
            <CardContent>
              <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <Meta label="Warehouse">
                  {c.warehouse.code} — {c.warehouse.name}
                </Meta>
                <Meta label="Products">{c.category?.name ?? 'All held here'}</Meta>
                <Meta label="Counted">
                  {c.progress.counted} of {c.progress.total}
                </Meta>
                <Meta label="Started">
                  {c.createdBy.name}, {formatDateTime(c.createdAt)}
                </Meta>
                {c.postedBy ? (
                  <Meta label="Posted">
                    {c.postedBy.name}, {formatDateTime(c.postedAt)}
                  </Meta>
                ) : null}
                {c.adjustment ? (
                  <Meta label="Adjustment">
                    <Link
                      to={`/stock/adjustments/${c.adjustment.id}`}
                      className="font-mono hover:underline"
                    >
                      {c.adjustment.number}
                    </Link>
                  </Meta>
                ) : null}
                {c.notes ? (
                  <div className="sm:col-span-2 lg:col-span-4">
                    <Meta label="Notes">{c.notes}</Meta>
                  </div>
                ) : null}
              </dl>
            </CardContent>
          </Card>
          {c.status === 'counting' && canCount ? (
            <CountSheet count={c} />
          ) : c.status === 'submitted' && canPost ? (
            <ReviewForm count={c} />
          ) : (
            <VarianceTable count={c} />
          )}
        </div>
        <Card className="self-start">
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            <History entries={c.history} />
          </CardContent>
        </Card>
      </div>
      <ReasonDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title="Cancel stock count"
        description="Nothing has been posted, so stock doesn't change."
        confirmLabel="Cancel count"
        destructive
        onConfirm={async (reason) => {
          await action.mutateAsync({ id: c.id, action: 'cancel', body: { reason } });
          toast.success(`${c.number} cancelled`);
        }}
      />
    </>
  );
}

const WHOLE = /^\d{1,9}$/;

/** Count entry. System quantities are hidden by default so counts aren't anchored to them. */
function CountSheet({ count: c }: { count: StockCountDto }) {
  const record = useRecordCounts();
  const action = useStockCountAction();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      c.lines.map((l) => [l.id, l.countedQuantity === null ? '' : String(l.countedQuantity)]),
    ),
  );
  const [showSystem, setShowSystem] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState<'save' | 'submit' | null>(null);

  const save = async (andSubmit: boolean) => {
    setFormError(null);
    const issues: Record<string, string> = {};
    c.lines.forEach((l) => {
      const v = values[l.id]!.trim();
      if (v !== '' && !WHOLE.test(v)) issues[l.id] = 'Whole number';
      if (andSubmit && v === '') issues[l.id] = 'Count this product';
    });
    setErrors(issues);
    if (Object.keys(issues).length > 0) {
      if (andSubmit) setFormError('Count every product before submitting.');
      return;
    }
    setPending(andSubmit ? 'submit' : 'save');
    try {
      await record.mutateAsync({
        id: c.id,
        lines: c.lines.map((l) => ({
          lineId: l.id,
          countedQuantity: values[l.id]!.trim() === '' ? null : Number(values[l.id]),
        })),
      });
      if (andSubmit) {
        await action.mutateAsync({ id: c.id, action: 'submit' });
        toast.success('Submitted for review');
      } else {
        toast.success('Counts saved');
      }
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    } finally {
      setPending(null);
    }
  };

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save(true);
      }}
    >
      <FormAlert message={formError} />
      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Switch id="show-system" checked={showSystem} onCheckedChange={setShowSystem} />
          <Label htmlFor="show-system" className="text-sm font-normal">
            Show system quantities
          </Label>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Product</TableHead>
              {showSystem ? <TableHead className="text-right">System</TableHead> : null}
              <TableHead className="w-32 pr-4">Counted</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {c.lines.map((l) => (
              <TableRow key={l.id} className="align-top">
                <TableCell className="pl-4">
                  <ProductCell line={l} />
                </TableCell>
                {showSystem ? (
                  <TableCell className="pt-4 text-right tabular-nums">{l.systemQuantity}</TableCell>
                ) : null}
                <TableCell className="pr-4">
                  <Input
                    aria-label={`Counted quantity for ${l.sku}`}
                    aria-invalid={errors[l.id] ? true : undefined}
                    inputMode="numeric"
                    value={values[l.id]}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [l.id]: event.target.value }))
                    }
                  />
                  {errors[l.id] ? (
                    <p className="text-destructive mt-1 text-xs">{errors[l.id]}</p>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending !== null}>
          {pending === 'submit' ? <Loader2 className="animate-spin" /> : null}
          Submit for review
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending !== null}
          onClick={() => void save(false)}
        >
          {pending === 'save' ? <Loader2 className="animate-spin" /> : null}
          Save progress
        </Button>
      </div>
    </form>
  );
}

/** Variances against stock now; each needs a reason before posting. */
function ReviewForm({ count: c }: { count: StockCountDto }) {
  const action = useStockCountAction();
  const [reasons, setReasons] = useState<
    Record<string, { reason: VarianceReason | ''; note: string }>
  >(() => Object.fromEntries(c.lines.map((l) => [l.id, { reason: l.reason ?? '', note: l.note }])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const withVariance = c.lines.filter((l) => l.variance !== null && l.variance !== 0);

  const allowed = (variance: number) =>
    VARIANCE_REASONS.filter((r) =>
      variance > 0 ? r === 'found' || r === 'correction' : r !== 'found',
    );

  const post = async () => {
    setFormError(null);
    const issues: Record<string, string> = {};
    c.lines.forEach((l, index) => {
      if (l.variance && !reasons[l.id]!.reason) issues[`lines.${index}.reason`] = 'Choose a reason';
    });
    setErrors(issues);
    if (Object.keys(issues).length > 0) return;
    setPending(true);
    try {
      await action.mutateAsync({
        id: c.id,
        action: 'post',
        body: {
          lines: withVariance.map((l) => ({
            lineId: l.id,
            reason: reasons[l.id]!.reason || null,
            note: reasons[l.id]!.note.trim(),
          })),
        },
      });
      toast.success(
        withVariance.length === 0
          ? 'Count posted; no variances'
          : `${withVariance.length} variances posted`,
      );
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
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void post();
      }}
    >
      <FormAlert message={formError} />
      <Card className="gap-0 overflow-hidden py-0">
        <p className="text-muted-foreground border-b px-4 py-3 text-sm">
          {withVariance.length === 0
            ? 'Every count matches stock. Posting records the count with no adjustment.'
            : `${withVariance.length} of ${c.lines.length} products differ from stock. Variances are measured against on-hand now.`}
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Product</TableHead>
              <TableHead className="text-right">System</TableHead>
              <TableHead className="text-right">Counted</TableHead>
              <TableHead className="text-right">Variance</TableHead>
              <TableHead className="min-w-40">Reason</TableHead>
              <TableHead className="min-w-40 pr-4">Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {c.lines.map((l, index) => {
              const v = l.variance ?? 0;
              const error =
                errors[`lines.${index}.reason`] ?? errors[`lines.${index}.countedQuantity`];
              return (
                <TableRow key={l.id} className="align-top">
                  <TableCell className="pl-4">
                    <ProductCell line={l} />
                    {l.reserved > 0 ? (
                      <div className="text-muted-foreground text-xs">{l.reserved} reserved</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="pt-4 text-right tabular-nums">{l.systemQuantity}</TableCell>
                  <TableCell className="pt-4 text-right tabular-nums">
                    {l.countedQuantity}
                  </TableCell>
                  <TableCell className="pt-4 text-right">
                    <Variance value={v} />
                  </TableCell>
                  <TableCell>
                    {v !== 0 ? (
                      <Select
                        value={reasons[l.id]!.reason}
                        onValueChange={(reason) =>
                          setReasons((current) => ({
                            ...current,
                            [l.id]: { ...current[l.id]!, reason: reason as VarianceReason },
                          }))
                        }
                      >
                        <SelectTrigger
                          aria-label={`Reason for ${l.sku}`}
                          aria-invalid={error ? true : undefined}
                          className="w-full"
                        >
                          <SelectValue placeholder="Choose" />
                        </SelectTrigger>
                        <SelectContent>
                          {allowed(v).map((r) => (
                            <SelectItem key={r} value={r}>
                              {r === 'correction'
                                ? 'Miscount or correction'
                                : ADJUSTMENT_REASON_LABELS[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                    {error ? <p className="text-destructive mt-1 text-xs">{error}</p> : null}
                  </TableCell>
                  <TableCell className="pr-4">
                    {v !== 0 ? (
                      <Input
                        aria-label={`Note for ${l.sku}`}
                        value={reasons[l.id]!.note}
                        maxLength={200}
                        onChange={(event) =>
                          setReasons((current) => ({
                            ...current,
                            [l.id]: { ...current[l.id]!, note: event.target.value },
                          }))
                        }
                      />
                    ) : null}
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
          {withVariance.length === 0 ? 'Post count' : 'Post variances'}
        </Button>
      </div>
    </form>
  );
}

function VarianceTable({ count: c }: { count: StockCountDto }) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Product</TableHead>
            <TableHead className="text-right">System</TableHead>
            <TableHead className="text-right">Counted</TableHead>
            <TableHead className="text-right">Variance</TableHead>
            <TableHead className="pr-4">Reason</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {c.lines.map((l) => (
            <TableRow key={l.id}>
              <TableCell className="pl-4">
                <ProductCell line={l} />
              </TableCell>
              <TableCell className="text-right tabular-nums">{l.systemQuantity}</TableCell>
              <TableCell className="text-right tabular-nums">{l.countedQuantity ?? '—'}</TableCell>
              <TableCell className="text-right">
                {l.variance === null ? '—' : <Variance value={l.variance} />}
              </TableCell>
              <TableCell className="pr-4">
                {l.reason ? ADJUSTMENT_REASON_LABELS[l.reason] : '—'}
                {l.note ? <div className="text-muted-foreground text-xs">{l.note}</div> : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function Variance({ value }: { value: number }) {
  if (value === 0) return <span className="text-muted-foreground tabular-nums">0</span>;
  return (
    <span
      className={cn('font-medium tabular-nums', value > 0 ? 'text-emerald-700' : 'text-red-700')}
    >
      {value > 0 ? '+' : '−'}
      {Math.abs(value)}
    </span>
  );
}

function ProductCell({ line }: { line: StockCountDto['lines'][number] }) {
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
