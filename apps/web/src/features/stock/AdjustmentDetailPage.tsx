import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { ADJUSTMENT_REASON_LABELS, type StockAdjustmentDto } from '@stockflow/shared';
import { BackLink } from '@/components/BackLink';
import { ReasonDialog } from '@/components/document-parts';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { NotFoundPage } from '@/components/StatusPages';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { usePermission } from '@/features/auth/auth-context';
import { useMoney } from '@/features/settings/api';
import { ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAdjustment, useReverseAdjustment } from './api';
import { StockDocumentBadge } from './StockDocumentBadge';

export function AdjustmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const doc = useAdjustment(id);

  if (doc.isError && doc.error instanceof ApiError && doc.error.status === 404)
    return <NotFoundPage />;
  if (!doc.data) {
    return doc.isError ? (
      <p className="text-destructive text-sm">Couldn't load this document.</p>
    ) : (
      <Skeleton className="h-64 w-full" />
    );
  }
  return <Detail doc={doc.data} />;
}

function Detail({ doc: d }: { doc: StockAdjustmentDto }) {
  const money = useMoney();
  const navigate = useNavigate();
  const canAdjust = usePermission('stock:adjust');
  const reverse = useReverseAdjustment();
  const [reversing, setReversing] = useState(false);
  const isQuarantineDoc = d.type === 'quarantine' || d.type === 'release' || d.type === 'write_off';
  const reversible = d.type === 'adjustment' && !d.reversalOf && !d.reversedBy;
  const showLineReasons = d.lines.some((l) => l.reason);

  return (
    <>
      <BackLink to="/stock/adjustments" label="Adjustments" />
      <PageHeader
        title={d.number}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StockDocumentBadge type={d.type} />
            {d.reversedBy ? <StatusBadge tone="red">Reversed</StatusBadge> : null}
            {d.reversalOf ? <StatusBadge tone="gray">Reversal</StatusBadge> : null}
          </span>
        }
        actions={
          reversible && canAdjust ? (
            <Button variant="outline" onClick={() => setReversing(true)}>
              <Undo2 />
              Reverse
            </Button>
          ) : null
        }
      />
      {d.reversedBy ? (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Reversed by{' '}
          <Link to={`/stock/adjustments/${d.reversedBy.id}`} className="font-mono underline">
            {d.reversedBy.number}
          </Link>
          . Its movements remain in the ledger alongside the reversal's.
        </p>
      ) : null}
      <Card className="mb-6">
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Meta label="Warehouse">
              {d.warehouse.code} — {d.warehouse.name}
            </Meta>
            <Meta label="Reason">
              {d.reason ? ADJUSTMENT_REASON_LABELS[d.reason] : 'Opening stock'}
            </Meta>
            <Meta label="Posted">{formatDateTime(d.createdAt)}</Meta>
            <Meta label="Posted by">{d.createdBy.name}</Meta>
            {d.source ? (
              <Meta label={d.source.type === 'stockCount' ? 'From stock count' : 'From transfer'}>
                <Link
                  to={
                    d.source.type === 'stockCount'
                      ? `/stock/counts/${d.source.id}`
                      : `/stock/transfers/${d.source.id}`
                  }
                  className="font-mono hover:underline"
                >
                  {d.source.number}
                </Link>
              </Meta>
            ) : null}
            {d.reversalOf ? (
              <Meta label="Reverses">
                <Link
                  to={`/stock/adjustments/${d.reversalOf.id}`}
                  className="font-mono hover:underline"
                >
                  {d.reversalOf.number}
                </Link>
              </Meta>
            ) : null}
            {d.notes ? (
              <div className="sm:col-span-2 lg:col-span-4">
                <Meta label="Notes">{d.notes}</Meta>
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
              {showLineReasons ? <TableHead>Reason</TableHead> : null}
              <TableHead className="text-right">
                {isQuarantineDoc ? 'Usable before' : 'Before'}
              </TableHead>
              <TableHead className="text-right">Change</TableHead>
              <TableHead className="text-right">
                {isQuarantineDoc ? 'Usable after' : 'After'}
              </TableHead>
              {isQuarantineDoc ? (
                <TableHead className="text-right">Quarantine after</TableHead>
              ) : null}
              <TableHead className="pr-4 text-right">Unit cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.lines.map((line) => (
              <TableRow key={line.productId}>
                <TableCell className="pl-4">
                  <Link to={`/products/${line.productId}`} className="font-medium hover:underline">
                    {line.name}
                  </Link>
                  <div className="text-muted-foreground font-mono text-xs">{line.sku}</div>
                </TableCell>
                {showLineReasons ? (
                  <TableCell>{line.reason ? ADJUSTMENT_REASON_LABELS[line.reason] : '—'}</TableCell>
                ) : null}
                <TableCell className="text-right tabular-nums">{line.previousOnHand}</TableCell>
                <TableCell
                  className={cn(
                    'text-right font-medium tabular-nums',
                    line.quantityChange > 0 ? 'text-emerald-700' : 'text-red-700',
                  )}
                >
                  {line.quantityChange > 0 ? '+' : '−'}
                  {Math.abs(line.quantityChange)} {line.unit}
                </TableCell>
                <TableCell className="text-right tabular-nums">{line.balanceAfter}</TableCell>
                {isQuarantineDoc ? (
                  <TableCell className="text-right tabular-nums">
                    {line.quarantineAfter ?? '—'}
                  </TableCell>
                ) : null}
                <TableCell className="pr-4 text-right tabular-nums">
                  {money(line.unitCost)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="pl-4" colSpan={showLineReasons ? 3 : 2}>
                Total
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {d.totalIn > 0 ? <span className="text-emerald-700">+{d.totalIn}</span> : null}
                {d.totalIn > 0 && d.totalOut > 0 ? ' / ' : null}
                {d.totalOut > 0 ? <span className="text-red-700">−{d.totalOut}</span> : null}
              </TableCell>
              <TableCell colSpan={isQuarantineDoc ? 3 : 2} />
            </TableRow>
          </TableFooter>
        </Table>
      </Card>

      <ReasonDialog
        open={reversing}
        onOpenChange={setReversing}
        title={`Reverse ${d.number}`}
        description="Posts the exact opposite quantities as a new adjustment. The original and its movements stay in the ledger."
        confirmLabel="Post reversal"
        onConfirm={async (reason) => {
          const reversal = await reverse.mutateAsync({ id: d.id, reason });
          toast.success(`${reversal.number} posted`);
          void navigate(`/stock/adjustments/${reversal.id}`);
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
