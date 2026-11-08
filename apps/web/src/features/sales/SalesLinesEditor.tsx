import { Plus, Trash2 } from 'lucide-react';
import {
  basisPointsToPercent,
  minorToDecimal,
  parseMoney,
  parsePercent,
  salesLineAmounts,
  type WarehouseAvailabilityDto,
} from '@stockflow/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import { useMoney } from '@/features/settings/api';

export interface SalesLine {
  key: number;
  productId: string;
  quantity: string;
  unitPrice: string;
  discount: string;
}

let nextKey = 1;
export const newSalesLine = (init: Partial<Omit<SalesLine, 'key'>> = {}): SalesLine => ({
  key: nextKey++,
  productId: '',
  quantity: '',
  unitPrice: '',
  discount: '',
  ...init,
});

export const salesLineFromOrder = (l: {
  productId: string;
  quantity: number;
  unitPrice: number;
  discountRate: number;
}) =>
  newSalesLine({
    productId: l.productId,
    quantity: String(l.quantity),
    unitPrice: minorToDecimal(l.unitPrice),
    discount: l.discountRate ? basisPointsToPercent(l.discountRate) : '',
  });

export type LineErrors = Record<string, string>;

const WHOLE = /^\d{1,9}$/;

/** Client-side checks using the paths the API reports (lines.N.field). */
export function validateSalesLines(lines: SalesLine[]): LineErrors {
  const errors: LineErrors = {};
  if (lines.length === 0) errors.lines = 'Add at least one product';
  lines.forEach((line, i) => {
    if (!line.productId) errors[`lines.${i}.productId`] = 'Select a product';
    if (!WHOLE.test(line.quantity.trim()) || Number(line.quantity) < 1) {
      errors[`lines.${i}.quantity`] = 'Enter 1 or more';
    }
    if (line.unitPrice.trim() !== '' && parseMoney(line.unitPrice) === null) {
      errors[`lines.${i}.unitPrice`] = 'Enter an amount such as 12.50';
    }
    if (line.discount.trim() !== '' && parsePercent(line.discount) === null) {
      errors[`lines.${i}.discountRate`] = '0–100%';
    }
  });
  return errors;
}

export const toSalesLineInput = (l: SalesLine) => ({
  productId: l.productId,
  quantity: Number(l.quantity),
  ...(l.unitPrice.trim() ? { unitPrice: parseMoney(l.unitPrice)! } : {}),
  discountRate: l.discount.trim() ? parsePercent(l.discount)! : 0,
});

interface Props {
  lines: SalesLine[];
  onChange: (lines: SalesLine[]) => void;
  errors: LineErrors;
  warehouseId: string;
  availability: Map<string, WarehouseAvailabilityDto[]> | undefined;
}

export function SalesLinesEditor({ lines, onChange, errors, warehouseId, availability }: Props) {
  const update = (key: number, changes: Partial<SalesLine>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...changes } : l)));
  const selected = lines.map((l) => l.productId).filter(Boolean);

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-64 pl-4">Product</TableHead>
            <TableHead className="w-28">Quantity</TableHead>
            <TableHead className="min-w-36">Available</TableHead>
            <TableHead className="w-32">Unit price</TableHead>
            <TableHead className="w-24">Discount %</TableHead>
            <TableHead className="text-right">Line total</TableHead>
            <TableHead className="w-12 pr-4">
              <span className="sr-only">Remove</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line, index) => (
            <LineRow
              key={line.key}
              index={index}
              line={line}
              errors={errors}
              excludeIds={selected}
              warehouseId={warehouseId}
              stock={line.productId ? availability?.get(line.productId) : undefined}
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
          onClick={() => onChange([...lines, newSalesLine()])}
        >
          <Plus />
          Add product
        </Button>
        {errors.lines ? <p className="text-destructive text-xs">{errors.lines}</p> : null}
      </div>
    </Card>
  );
}

interface RowProps {
  index: number;
  line: SalesLine;
  errors: LineErrors;
  excludeIds: string[];
  warehouseId: string;
  stock: WarehouseAvailabilityDto[] | undefined;
  onChange: (changes: Partial<SalesLine>) => void;
  onRemove: (() => void) | undefined;
}

function LineRow({
  index,
  line,
  errors,
  excludeIds,
  warehouseId,
  stock,
  onChange,
  onRemove,
}: RowProps) {
  const product = useProduct(line.productId || undefined);
  const money = useMoney();
  const enteredPrice = line.unitPrice.trim() ? parseMoney(line.unitPrice) : null;
  const unitPrice = enteredPrice ?? product.data?.sellingPrice;
  const discount = line.discount.trim() ? (parsePercent(line.discount) ?? 0) : 0;
  const quantity = WHOLE.test(line.quantity.trim()) ? Number(line.quantity) : null;
  const amounts =
    quantity !== null && unitPrice !== undefined && product.data
      ? salesLineAmounts(quantity, unitPrice, discount, product.data.taxRate)
      : null;
  const err = (field: string) => errors[`lines.${index}.${field}`];

  return (
    <TableRow className="align-top">
      <TableCell className="pl-4">
        <ProductPicker
          id={`line-${index}-product`}
          label={`Product for line ${index + 1}`}
          value={line.productId}
          onChange={(productId) => onChange({ productId, unitPrice: '' })}
          activeOnly
          excludeIds={excludeIds}
          invalid={Boolean(err('productId'))}
        />
        {err('productId') ? (
          <p className="text-destructive mt-1 text-xs">{err('productId')}</p>
        ) : null}
      </TableCell>
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
      <TableCell className="pt-4">
        <Availability
          stock={stock}
          warehouseId={warehouseId}
          quantity={quantity}
          unit={product.data?.unit}
        />
      </TableCell>
      <TableCell>
        <Input
          aria-label={`Unit price for line ${index + 1}`}
          aria-invalid={err('unitPrice') ? true : undefined}
          inputMode="decimal"
          placeholder={product.data ? minorToDecimal(product.data.sellingPrice) : undefined}
          value={line.unitPrice}
          onChange={(event) => onChange({ unitPrice: event.target.value })}
        />
        {err('unitPrice') ? (
          <p className="text-destructive mt-1 text-xs">{err('unitPrice')}</p>
        ) : line.productId && !line.unitPrice && product.data ? (
          <p className="text-muted-foreground mt-1 text-xs">Selling price</p>
        ) : null}
      </TableCell>
      <TableCell>
        <Input
          aria-label={`Discount for line ${index + 1}`}
          aria-invalid={err('discountRate') ? true : undefined}
          inputMode="decimal"
          placeholder="0"
          value={line.discount}
          onChange={(event) => onChange({ discount: event.target.value })}
        />
        {err('discountRate') ? (
          <p className="text-destructive mt-1 text-xs">{err('discountRate')}</p>
        ) : null}
      </TableCell>
      <TableCell className="pt-4 text-right tabular-nums">
        {amounts ? money(amounts.lineTotal) : '—'}
        {amounts && amounts.lineDiscount > 0 ? (
          <div className="text-muted-foreground text-xs">
            −{money(amounts.lineDiscount)} discount
          </div>
        ) : null}
        {amounts && amounts.lineTax > 0 ? (
          <div className="text-muted-foreground text-xs">incl. {money(amounts.lineTax)} tax</div>
        ) : null}
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

/** Available stock in the order's warehouse, with other warehouses as a hint when short. */
export function Availability({
  stock,
  warehouseId,
  quantity,
  unit,
}: {
  stock: WarehouseAvailabilityDto[] | undefined;
  warehouseId: string;
  quantity: number | null;
  unit: string | undefined;
}) {
  if (!stock || !warehouseId) return <span className="text-muted-foreground">—</span>;
  const here = stock.find((s) => s.warehouse.id === warehouseId);
  const available = here?.available ?? 0;
  const short = quantity !== null && quantity > available;
  const elsewhere = stock.filter(
    (s) => s.warehouse.id !== warehouseId && s.warehouse.isActive && s.available > 0,
  );
  return (
    <div className="text-sm">
      <span className={short ? 'font-medium text-red-700' : 'tabular-nums'}>
        {available} {unit}
      </span>
      {here && here.reserved > 0 ? (
        <span className="text-muted-foreground text-xs"> ({here.reserved} reserved)</span>
      ) : null}
      {short ? (
        <p className="mt-0.5 text-xs text-red-700">
          Short by {quantity - available}
          {elsewhere.length > 0
            ? `. ${elsewhere.map((s) => `${s.warehouse.code}: ${s.available}`).join(', ')}`
            : ''}
        </p>
      ) : null}
    </div>
  );
}
