import { Link } from 'react-router';
import { MOVEMENT_TYPE_LABELS, type StockMovementDto } from '@stockflow/shared';
import { TableBodyState } from '@/components/table';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Props {
  rows: StockMovementDto[];
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  emptyMessage: string;
  showProduct?: boolean;
}

export function MovementsTable({
  rows,
  isPending,
  isError,
  onRetry,
  emptyMessage,
  showProduct = true,
}: Props) {
  const cols = showProduct ? 8 : 7;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-4">Date</TableHead>
          {showProduct ? <TableHead>Product</TableHead> : null}
          <TableHead>Warehouse</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Reference</TableHead>
          <TableHead className="text-right">Change</TableHead>
          <TableHead className="text-right">Balance</TableHead>
          <TableHead className="hidden pr-4 lg:table-cell">By</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableBodyState
          colSpan={cols}
          isPending={isPending}
          isError={isError}
          isEmpty={rows.length === 0}
          onRetry={onRetry}
          emptyMessage={emptyMessage}
        >
          {rows.map((m) => (
            <TableRow key={m.id}>
              <TableCell className="pl-4 whitespace-nowrap">
                {formatDateTime(m.createdAt)}
              </TableCell>
              {showProduct ? (
                <TableCell>
                  <Link to={`/products/${m.product.id}`} className="font-medium hover:underline">
                    {m.product.name}
                  </Link>
                  <div className="text-muted-foreground font-mono text-xs">{m.product.sku}</div>
                </TableCell>
              ) : null}
              <TableCell>
                <span className="font-mono text-xs">{m.warehouse.code}</span>
              </TableCell>
              <TableCell>
                {MOVEMENT_TYPE_LABELS[m.type]}
                {m.bucket === 'quarantine' ? (
                  <div className="text-xs text-amber-800">Quarantine</div>
                ) : null}
              </TableCell>
              <TableCell>
                <Link to={referencePath(m.reference)} className="font-mono text-xs hover:underline">
                  {m.reference.number}
                </Link>
              </TableCell>
              <TableCell
                className={cn(
                  'text-right font-medium tabular-nums',
                  m.quantity > 0 ? 'text-emerald-700' : 'text-red-700',
                )}
              >
                {m.quantity > 0 ? '+' : '−'}
                {Math.abs(m.quantity).toLocaleString()}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {m.balanceAfter.toLocaleString()}
              </TableCell>
              <TableCell className="text-muted-foreground hidden pr-4 lg:table-cell">
                {m.createdBy.name}
              </TableCell>
            </TableRow>
          ))}
        </TableBodyState>
      </TableBody>
    </Table>
  );
}

const REFERENCE_PATHS: Record<StockMovementDto['reference']['type'], string> = {
  opening: '/stock/adjustments',
  adjustment: '/stock/adjustments',
  quarantine: '/stock/adjustments',
  release: '/stock/adjustments',
  write_off: '/stock/adjustments',
  goodsReceipt: '/goods-receipts',
  shipment: '/shipments',
  transfer: '/stock/transfers',
  customerReturn: '/customer-returns',
  supplierReturn: '/supplier-returns',
};

function referencePath(reference: StockMovementDto['reference']) {
  return `${REFERENCE_PATHS[reference.type]}/${reference.id}`;
}
