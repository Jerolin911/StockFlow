import { Plus, Trash2 } from 'lucide-react';
import { lineAmounts, minorToDecimal, parseMoney } from '@stockflow/shared';
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

export interface EditorLine {
  key: number;
  productId: string;
  quantity: string;
  unitCost: string;
  note: string;
}

let nextKey = 1;
export const newEditorLine = (init: Partial<Omit<EditorLine, 'key'>> = {}): EditorLine => ({
  key: nextKey++,
  productId: '',
  quantity: '',
  unitCost: '',
  note: '',
  ...init,
});

type Mode = 'request' | 'order';
export type LineErrors = Record<string, string>;

/** Client-side checks using the same paths the API reports (lines.N.field). */
export function validateLines(lines: EditorLine[], mode: Mode): LineErrors {
  const errors: LineErrors = {};
  if (lines.length === 0) errors.lines = 'Add at least one product';
  lines.forEach((line, i) => {
    if (!line.productId) errors[`lines.${i}.productId`] = 'Select a product';
    if (!/^\d{1,9}$/.test(line.quantity.trim()) || Number(line.quantity) < 1) {
      errors[`lines.${i}.quantity`] = 'Enter 1 or more';
    }
    if (mode === 'order' && line.unitCost.trim() !== '' && parseMoney(line.unitCost) === null) {
      errors[`lines.${i}.unitCost`] = 'Enter an amount such as 12.50';
    }
  });
  return errors;
}

interface Props {
  mode: Mode;
  lines: EditorLine[];
  onChange: (lines: EditorLine[]) => void;
  errors: LineErrors;
  /** Supplier prices by product id, used as the default unit cost. */
  supplierPrices?: Map<string, number>;
}

export function LinesEditor({ mode, lines, onChange, errors, supplierPrices }: Props) {
  const update = (key: number, changes: Partial<EditorLine>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...changes } : l)));
  const selected = lines.map((l) => l.productId).filter(Boolean);

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-64 pl-4">Product</TableHead>
            <TableHead className="w-28">Quantity</TableHead>
            {mode === 'order' ? (
              <>
                <TableHead className="w-32">Unit cost</TableHead>
                <TableHead className="text-right">Line total</TableHead>
              </>
            ) : (
              <TableHead>Note</TableHead>
            )}
            <TableHead className="w-12 pr-4">
              <span className="sr-only">Remove</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line, index) => (
            <LineRow
              key={line.key}
              mode={mode}
              index={index}
              line={line}
              errors={errors}
              excludeIds={selected}
              supplierPrice={supplierPrices?.get(line.productId)}
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
          onClick={() => onChange([...lines, newEditorLine()])}
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
  mode: Mode;
  index: number;
  line: EditorLine;
  errors: LineErrors;
  excludeIds: string[];
  supplierPrice: number | undefined;
  onChange: (changes: Partial<EditorLine>) => void;
  onRemove: (() => void) | undefined;
}

function LineRow({
  mode,
  index,
  line,
  errors,
  excludeIds,
  supplierPrice,
  onChange,
  onRemove,
}: RowProps) {
  const product = useProduct(line.productId || undefined);
  const money = useMoney();
  const defaultCost = supplierPrice ?? product.data?.costPrice;
  const enteredCost = line.unitCost.trim() ? parseMoney(line.unitCost) : null;
  const unitCost = enteredCost ?? defaultCost;
  const quantity = /^\d{1,9}$/.test(line.quantity.trim()) ? Number(line.quantity) : null;
  const amounts =
    quantity !== null && unitCost !== undefined && product.data
      ? lineAmounts(quantity, unitCost, product.data.taxRate)
      : null;
  const err = (field: string) => errors[`lines.${index}.${field}`];

  return (
    <TableRow className="align-top">
      <TableCell className="pl-4">
        <ProductPicker
          id={`line-${index}-product`}
          label={`Product for line ${index + 1}`}
          value={line.productId}
          onChange={(productId) => onChange({ productId, unitCost: '' })}
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
      {mode === 'order' ? (
        <>
          <TableCell>
            <Input
              aria-label={`Unit cost for line ${index + 1}`}
              aria-invalid={err('unitCost') ? true : undefined}
              inputMode="decimal"
              placeholder={defaultCost !== undefined ? minorToDecimal(defaultCost) : undefined}
              value={line.unitCost}
              onChange={(event) => onChange({ unitCost: event.target.value })}
            />
            {err('unitCost') ? (
              <p className="text-destructive mt-1 text-xs">{err('unitCost')}</p>
            ) : line.productId && !line.unitCost && defaultCost !== undefined ? (
              <p className="text-muted-foreground mt-1 text-xs">
                {supplierPrice !== undefined ? 'Supplier price' : 'Product cost'}
              </p>
            ) : null}
          </TableCell>
          <TableCell className="pt-4 text-right tabular-nums">
            {amounts ? money(amounts.lineTotal) : '—'}
            {amounts && amounts.lineTax > 0 ? (
              <div className="text-muted-foreground text-xs">
                incl. {money(amounts.lineTax)} tax
              </div>
            ) : null}
          </TableCell>
        </>
      ) : (
        <TableCell>
          <Input
            aria-label={`Note for line ${index + 1}`}
            value={line.note}
            maxLength={200}
            onChange={(event) => onChange({ note: event.target.value })}
          />
        </TableCell>
      )}
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
