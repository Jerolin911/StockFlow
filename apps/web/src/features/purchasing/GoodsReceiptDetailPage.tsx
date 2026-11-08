import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { BackLink } from '@/components/BackLink';
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
import { useGoodsReceipt } from './api';

export function GoodsReceiptDetailPage() {
  const { id } = useParams<{ id: string }>();
  const receipt = useGoodsReceipt(id);
  const money = useMoney();

  if (receipt.isError && receipt.error instanceof ApiError && receipt.error.status === 404)
    return <NotFoundPage />;
  if (!receipt.data) {
    return receipt.isError ? (
      <p className="text-destructive text-sm">Couldn't load this receipt.</p>
    ) : (
      <Skeleton className="h-64 w-full" />
    );
  }
  const grn = receipt.data;

  return (
    <>
      <BackLink to="/goods-receipts" label="Goods receipts" />
      <PageHeader
        title={grn.number}
        description={
          grn.onTime === null ? undefined : grn.onTime ? (
            <StatusBadge tone="green">On time</StatusBadge>
          ) : (
            <StatusBadge tone="amber">Late</StatusBadge>
          )
        }
      />
      <Card className="mb-6">
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Meta label="Purchase order">
              <Link
                to={`/purchase-orders/${grn.purchaseOrder.id}`}
                className="font-mono hover:underline"
              >
                {grn.purchaseOrder.number}
              </Link>
            </Meta>
            <Meta label="Supplier">
              <Link to={`/suppliers/${grn.supplier.id}`} className="hover:underline">
                {grn.supplier.name}
              </Link>
            </Meta>
            <Meta label="Warehouse">
              {grn.warehouse.code} — {grn.warehouse.name}
            </Meta>
            <Meta label="Received">
              {formatDateTime(grn.receivedAt)} by {grn.createdBy.name}
            </Meta>
            <Meta label="Delivery note">{grn.deliveryNote || '—'}</Meta>
            {grn.notes ? (
              <div className="sm:col-span-2 lg:col-span-3">
                <Meta label="Notes">{grn.notes}</Meta>
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
              <TableHead className="text-right">Accepted</TableHead>
              <TableHead className="text-right">Rejected</TableHead>
              <TableHead className="text-right">Damaged</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead className="pr-4 text-right">Unit cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {grn.lines.map((l) => (
              <TableRow key={l.poLineId}>
                <TableCell className="pl-4">
                  <Link to={`/products/${l.productId}`} className="font-medium hover:underline">
                    {l.name}
                  </Link>
                  <div className="text-muted-foreground font-mono text-xs">{l.sku}</div>
                </TableCell>
                <TableCell className="text-right font-medium text-emerald-700 tabular-nums">
                  {l.acceptedQuantity > 0 ? `+${l.acceptedQuantity}` : 0}
                </TableCell>
                <TableCell
                  className={cn(
                    'text-right tabular-nums',
                    l.rejectedQuantity > 0 && 'text-red-700',
                  )}
                >
                  {l.rejectedQuantity}
                </TableCell>
                <TableCell
                  className={cn('text-right tabular-nums', l.damagedQuantity > 0 && 'text-red-700')}
                >
                  {l.damagedQuantity}
                </TableCell>
                <TableCell className="text-muted-foreground">{l.rejectionReason || '—'}</TableCell>
                <TableCell className="pr-4 text-right tabular-nums">{money(l.unitCost)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="pl-4">Total</TableCell>
              <TableCell className="text-right tabular-nums">{grn.totals.accepted}</TableCell>
              <TableCell className="text-right tabular-nums">{grn.totals.rejected}</TableCell>
              <TableCell className="text-right tabular-nums">{grn.totals.damaged}</TableCell>
              <TableCell colSpan={2} />
            </TableRow>
          </TableFooter>
        </Table>
      </Card>
      <p className="text-muted-foreground mt-3 text-xs">
        Only accepted quantities were added to stock. Rejected and damaged quantities remain
        outstanding on the order.
      </p>
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
