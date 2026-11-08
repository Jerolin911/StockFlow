import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { ADJUSTMENT_REASON_LABELS } from '@stockflow/shared';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { NotFoundPage } from '@/components/StatusPages';
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
import { useMoney } from '@/features/settings/api';
import { ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAdjustment } from './api';

export function AdjustmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const doc = useAdjustment(id);
  const money = useMoney();

  if (doc.isError && doc.error instanceof ApiError && doc.error.status === 404)
    return <NotFoundPage />;
  if (!doc.data) {
    return doc.isError ? (
      <p className="text-destructive text-sm">Couldn't load this document.</p>
    ) : (
      <Skeleton className="h-64 w-full" />
    );
  }
  const d = doc.data;

  return (
    <>
      <Link
        to="/stock/adjustments"
        className="text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" />
        Adjustments
      </Link>
      <PageHeader
        title={d.number}
        description={
          d.type === 'opening' ? (
            <StatusBadge tone="blue">Opening stock</StatusBadge>
          ) : (
            <StatusBadge tone="gray">Adjustment</StatusBadge>
          )
        }
      />
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
              <TableHead className="text-right">Before</TableHead>
              <TableHead className="text-right">Change</TableHead>
              <TableHead className="text-right">After</TableHead>
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
                <TableCell className="pr-4 text-right tabular-nums">
                  {money(line.unitCost)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="pl-4">Total</TableCell>
              <TableCell />
              <TableCell className="text-right tabular-nums">
                {d.totalIn > 0 ? <span className="text-emerald-700">+{d.totalIn}</span> : null}
                {d.totalIn > 0 && d.totalOut > 0 ? ' / ' : null}
                {d.totalOut > 0 ? <span className="text-red-700">−{d.totalOut}</span> : null}
              </TableCell>
              <TableCell />
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </Card>
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
