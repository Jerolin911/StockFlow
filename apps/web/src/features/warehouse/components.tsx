import { Plus, Trash2 } from 'lucide-react';
import {
  STOCK_COUNT_STATUS_LABELS,
  TRANSFER_STATUS_LABELS,
  type StockBucket,
  type StockCountStatus,
  type TransferStatus,
  type WarehouseAvailabilityDto,
} from '@stockflow/shared';
import { StatusBadge, type Tone } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useProduct } from '@/features/catalog/api';
import { ProductPicker } from '@/features/catalog/ProductPicker';

const TRANSFER_TONES: Record<TransferStatus, Tone> = {
  requested: 'amber',
  approved: 'blue',
  in_transit: 'blue',
  partially_received: 'amber',
  received: 'green',
  closed: 'gray',
  rejected: 'red',
  cancelled: 'red',
};

const COUNT_TONES: Record<StockCountStatus, Tone> = {
  counting: 'amber',
  submitted: 'blue',
  posted: 'green',
  cancelled: 'red',
};

export function TransferStatusBadge({ status }: { status: TransferStatus }) {
  return <StatusBadge tone={TRANSFER_TONES[status]}>{TRANSFER_STATUS_LABELS[status]}</StatusBadge>;
}

export function StockCountStatusBadge({ status }: { status: StockCountStatus }) {
  return <StatusBadge tone={COUNT_TONES[status]}>{STOCK_COUNT_STATUS_LABELS[status]}</StatusBadge>;
}

// Product × quantity lines, shared by transfers, quarantine actions and supplier returns.

export interface QuantityLine {
  key: number;
  productId: string;
  quantity: string;
  source: StockBucket;
}

let nextKey = 1;
export const newQuantityLine = (init: Partial<Omit<QuantityLine, 'key'>> = {}): QuantityLine => ({
  key: nextKey++,
  productId: '',
  quantity: '',
  source: 'usable',
  ...init,
});

const WHOLE = /^\d{1,9}$/;

export function validateQuantityLines(lines: QuantityLine[], perSource = false) {
  const errors: Record<string, string> = {};
  if (lines.length === 0) errors.lines = 'Add at least one product';
  const seen = new Set<string>();
  lines.forEach((line, i) => {
    if (!line.productId) errors[`lines.${i}.productId`] = 'Select a product';
    if (!WHOLE.test(line.quantity.trim()) || Number(line.quantity) < 1) {
      errors[`lines.${i}.quantity`] = 'Enter 1 or more';
    }
    const key = perSource ? `${line.productId}:${line.source}` : line.productId;
    if (line.productId && seen.has(key)) errors[`lines.${i}.productId`] = 'Already on the list';
    seen.add(key);
  });
  return errors;
}

/** Which stock figure to show beside each line. */
export type StockColumn = 'available' | 'quarantine' | 'bySource';

interface EditorProps {
  lines: QuantityLine[];
  onChange: (lines: QuantityLine[]) => void;
  errors: Record<string, string>;
  warehouseId: string;
  availability: Map<string, WarehouseAvailabilityDto[]> | undefined;
  stockColumn: StockColumn;
  /** Shows a usable/quarantine selector per line (supplier returns). */
  withSource?: boolean;
}

export function QuantityLinesEditor({
  lines,
  onChange,
  errors,
  warehouseId,
  availability,
  stockColumn,
  withSource,
}: EditorProps) {
  const update = (key: number, changes: Partial<QuantityLine>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...changes } : l)));

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-64 pl-4">Product</TableHead>
            {withSource ? <TableHead className="w-40">From</TableHead> : null}
            <TableHead className="w-28">Quantity</TableHead>
            <TableHead>{stockColumn === 'quarantine' ? 'In quarantine' : 'Available'}</TableHead>
            <TableHead className="w-12 pr-4">
              <span className="sr-only">Remove</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line, index) => (
            <QuantityRow
              key={line.key}
              index={index}
              line={line}
              errors={errors}
              withSource={withSource ?? false}
              stock={availability?.get(line.productId)?.find((w) => w.warehouse.id === warehouseId)}
              stockColumn={stockColumn}
              onChange={(changes) => update(line.key, changes)}
              onRemove={
                lines.length > 1
                  ? () => onChange(lines.filter((l) => l.key !== line.key))
                  : undefined
              }
            />
          ))}
        </TableBody>
      </Table>
      <div className="flex items-center justify-between border-t px-4 py-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...lines, newQuantityLine()])}
        >
          <Plus />
          Add product
        </Button>
        {errors.lines ? <p className="text-destructive text-xs">{errors.lines}</p> : null}
      </div>
    </Card>
  );
}

function QuantityRow({
  index,
  line,
  errors,
  withSource,
  stock,
  stockColumn,
  onChange,
  onRemove,
}: {
  index: number;
  line: QuantityLine;
  errors: Record<string, string>;
  withSource: boolean;
  stock: WarehouseAvailabilityDto | undefined;
  stockColumn: StockColumn;
  onChange: (changes: Partial<QuantityLine>) => void;
  onRemove: (() => void) | undefined;
}) {
  const product = useProduct(line.productId || undefined);
  const err = (field: string) => errors[`lines.${index}.${field}`];
  const showQuarantine =
    stockColumn === 'quarantine' || (stockColumn === 'bySource' && line.source === 'quarantine');
  const figure = showQuarantine ? (stock?.quarantine ?? 0) : (stock?.available ?? 0);
  const quantity = WHOLE.test(line.quantity.trim()) ? Number(line.quantity) : null;
  const short = line.productId !== '' && quantity !== null && quantity > figure;

  return (
    <TableRow className="align-top">
      <TableCell className="pl-4">
        <ProductPicker
          id={`line-${index}-product`}
          label={`Product for line ${index + 1}`}
          value={line.productId}
          onChange={(productId) => onChange({ productId })}
          invalid={Boolean(err('productId'))}
        />
        {err('productId') ? (
          <p className="text-destructive mt-1 text-xs">{err('productId')}</p>
        ) : null}
      </TableCell>
      {withSource ? (
        <TableCell>
          <Select value={line.source} onValueChange={(v) => onChange({ source: v as StockBucket })}>
            <SelectTrigger aria-label={`Source for line ${index + 1}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="quarantine">Quarantine</SelectItem>
              <SelectItem value="usable">Usable stock</SelectItem>
            </SelectContent>
          </Select>
        </TableCell>
      ) : null}
      <TableCell>
        <div className="flex items-center gap-1.5">
          <Input
            aria-label={`Quantity for line ${index + 1}`}
            aria-invalid={err('quantity') ? true : undefined}
            inputMode="numeric"
            value={line.quantity}
            onChange={(event) => onChange({ quantity: event.target.value })}
          />
          <span className="text-muted-foreground text-xs">{product.data?.unit}</span>
        </div>
        {err('quantity') ? (
          <p className="text-destructive mt-1 text-xs">{err('quantity')}</p>
        ) : null}
      </TableCell>
      <TableCell className="pt-4 text-sm tabular-nums">
        {line.productId && stock !== undefined ? (
          <span className={short ? 'font-medium text-red-700' : undefined}>
            {figure} {product.data?.unit}
            {short ? <span className="block text-xs">Short by {quantity - figure}</span> : null}
          </span>
        ) : line.productId ? (
          <span className={quantity ? 'font-medium text-red-700' : undefined}>0</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="pr-4">
        {onRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRemove}
            aria-label={`Remove line ${index + 1}`}
          >
            <Trash2 />
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

export const toQuantityInput = (lines: QuantityLine[]) =>
  lines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity) }));
