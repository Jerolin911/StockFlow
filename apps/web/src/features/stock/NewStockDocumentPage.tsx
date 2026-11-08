import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  ADJUSTMENT_REASONS,
  ADJUSTMENT_REASON_LABELS,
  minorToDecimal,
  parseMoney,
  type AdjustmentReason,
} from '@stockflow/shared';
import { FormField, fieldA11y } from '@/components/FormField';
import { FormAlert } from '@/components/form-parts';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { Textarea } from '@/components/ui/textarea';
import { useProduct, useWarehouseOptions } from '@/features/catalog/api';
import { ProductPicker } from '@/features/catalog/ProductPicker';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { usePostAdjustment, useRegisterOpeningStock, useStockLevels } from './api';

type DocType = 'opening' | 'adjustment';

interface Line {
  key: number;
  productId: string;
  quantity: string;
  unitCost: string;
}

type Errors = Record<string, string>;

let nextKey = 1;
const newLine = (productId = ''): Line => ({
  key: nextKey++,
  productId,
  quantity: '',
  unitCost: '',
});

const INTEGER = /^-?\d{1,9}$/;
const WHOLE = /^\d{1,9}$/;

export function NewStockDocumentPage() {
  const [params] = useSearchParams();
  const type: DocType = params.get('type') === 'opening' ? 'opening' : 'adjustment';
  // Remount on type change so switching between the two forms starts clean.
  return <StockDocumentForm key={type} type={type} params={params} />;
}

function StockDocumentForm({ type, params }: { type: DocType; params: URLSearchParams }) {
  const navigate = useNavigate();
  const warehouses = useWarehouseOptions();
  const postAdjustment = usePostAdjustment();
  const registerOpening = useRegisterOpeningStock();

  const [warehouseId, setWarehouseId] = useState(params.get('warehouseId') ?? '');
  const [reason, setReason] = useState<AdjustmentReason | ''>('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>(() => [newLine(params.get('productId') ?? '')]);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const counting = reason === 'count';
  const isOpening = type === 'opening';

  const updateLine = (key: number, changes: Partial<Line>) =>
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...changes } : l)));

  const validate = (): Errors => {
    const issues: Errors = {};
    if (!warehouseId) issues.warehouseId = 'Select a warehouse';
    if (!isOpening && !reason) issues.reason = 'Select a reason';
    if (reason === 'other' && notes.trim() === '') issues.notes = 'Describe the reason';
    lines.forEach((line, index) => {
      if (!line.productId) issues[`lines.${index}.productId`] = 'Select a product';
      const qty = line.quantity.trim();
      const qtyKey = `lines.${index}.${isOpening ? 'quantity' : counting ? 'countedQuantity' : 'quantityChange'}`;
      if (isOpening && (!WHOLE.test(qty) || Number(qty) < 1))
        issues[qtyKey] = 'Enter a quantity of 1 or more';
      if (!isOpening && counting && !WHOLE.test(qty)) issues[qtyKey] = 'Enter the counted quantity';
      if (!isOpening && !counting && (!INTEGER.test(qty) || Number(qty) === 0)) {
        issues[qtyKey] = 'Enter a change such as 5 or -3';
      }
      if (isOpening && line.unitCost.trim() !== '' && parseMoney(line.unitCost) === null) {
        issues[`lines.${index}.unitCost`] = 'Enter an amount such as 12.50';
      }
    });
    if (lines.length === 0) issues.lines = 'Add at least one product';
    return issues;
  };

  const submit = async () => {
    setFormError(null);
    const issues = validate();
    setErrors(issues);
    if (Object.keys(issues).length > 0) return;

    setPending(true);
    try {
      const doc = isOpening
        ? await registerOpening.mutateAsync({
            warehouseId,
            notes,
            lines: lines.map((l) => ({
              productId: l.productId,
              quantity: Number(l.quantity),
              ...(l.unitCost.trim() ? { unitCost: parseMoney(l.unitCost)! } : {}),
            })),
          })
        : await postAdjustment.mutateAsync({
            warehouseId,
            reason: reason as AdjustmentReason,
            notes,
            lines: lines.map((l) =>
              counting
                ? { productId: l.productId, countedQuantity: Number(l.quantity) }
                : { productId: l.productId, quantityChange: Number(l.quantity) },
            ),
          });
      toast.success(`${doc.number} posted`);
      void navigate(`/stock/adjustments/${doc.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.details.length > 0) {
        setErrors(Object.fromEntries(error.details.map((d) => [d.path, d.message])));
      }
      setFormError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    } finally {
      setPending(false);
    }
  };

  const quantityLabel = isOpening ? 'Quantity' : counting ? 'Counted' : 'Change';
  const quantityField = isOpening ? 'quantity' : counting ? 'countedQuantity' : 'quantityChange';
  const selectedIds = lines.map((l) => l.productId).filter(Boolean);

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
        title={isOpening ? 'Register opening stock' : 'New stock adjustment'}
        description={
          isOpening
            ? 'Record the starting quantity of products in a warehouse. Each product can have opening stock once per warehouse.'
            : 'Correct quantities after counts, damage or losses. Every change is recorded in the movement ledger.'
        }
      />

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="grid gap-6"
      >
        <FormAlert message={formError} />
        <Card>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FormField id="doc-warehouse" label="Warehouse" error={errors.warehouseId}>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger
                  {...fieldA11y('doc-warehouse', errors.warehouseId)}
                  className="w-full"
                >
                  <SelectValue placeholder="Select a warehouse" />
                </SelectTrigger>
                <SelectContent>
                  {(warehouses.data ?? []).map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.code} — {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            {isOpening ? null : (
              <FormField id="doc-reason" label="Reason" error={errors.reason}>
                <Select
                  value={reason}
                  onValueChange={(value) => {
                    setReason(value as AdjustmentReason);
                    // Counted quantities and changes mean different things; don't carry values over.
                    if ((value === 'count') !== counting) {
                      setLines((current) => current.map((l) => ({ ...l, quantity: '' })));
                    }
                  }}
                >
                  <SelectTrigger {...fieldA11y('doc-reason', errors.reason)} className="w-full">
                    <SelectValue placeholder="Select a reason" />
                  </SelectTrigger>
                  <SelectContent>
                    {ADJUSTMENT_REASONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {ADJUSTMENT_REASON_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
            <div
              className={cn(
                isOpening ? 'sm:col-span-1 lg:col-span-2' : 'sm:col-span-2 lg:col-span-1',
              )}
            >
              <FormField id="doc-notes" label="Notes" error={errors.notes}>
                <Textarea
                  {...fieldA11y('doc-notes', errors.notes)}
                  rows={1}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </FormField>
            </div>
          </CardContent>
        </Card>

        <Card className="gap-0 overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-64 pl-4">Product</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="w-32">{quantityLabel}</TableHead>
                {isOpening ? <TableHead className="w-32">Unit cost</TableHead> : null}
                <TableHead className="text-right">After</TableHead>
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
                  type={type}
                  counting={counting}
                  warehouseId={warehouseId}
                  excludeIds={selectedIds}
                  errors={errors}
                  quantityField={quantityField}
                  onChange={(changes) => updateLine(line.key, changes)}
                  onRemove={
                    lines.length > 1
                      ? () => setLines((current) => current.filter((l) => l.key !== line.key))
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
              onClick={() => setLines((c) => [...c, newLine()])}
            >
              <Plus />
              Add product
            </Button>
            {errors.lines ? <p className="text-destructive text-xs">{errors.lines}</p> : null}
          </div>
        </Card>

        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            {isOpening ? 'Register opening stock' : 'Post adjustment'}
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link to="/stock/adjustments">Cancel</Link>
          </Button>
        </div>
      </form>
    </>
  );
}

interface LineRowProps {
  index: number;
  line: Line;
  type: DocType;
  counting: boolean;
  warehouseId: string;
  excludeIds: string[];
  errors: Errors;
  quantityField: string;
  onChange: (changes: Partial<Line>) => void;
  onRemove: (() => void) | undefined;
}

function LineRow({
  index,
  line,
  type,
  counting,
  warehouseId,
  excludeIds,
  errors,
  quantityField,
  onChange,
  onRemove,
}: LineRowProps) {
  const product = useProduct(line.productId || undefined);
  const levels = useStockLevels(
    { productId: line.productId, warehouseId, pageSize: 1 },
    Boolean(line.productId && warehouseId),
  );
  const level = levels.data?.data[0];
  const hasLevel = Boolean(level);
  const currentOnHand = level?.onHand ?? 0;
  const known = Boolean(line.productId && warehouseId && levels.data);

  const qty = line.quantity.trim();
  const parsed = INTEGER.test(qty) ? Number(qty) : null;
  const after =
    parsed === null
      ? null
      : type === 'opening'
        ? currentOnHand + parsed
        : counting
          ? parsed
          : currentOnHand + parsed;

  const productError = errors[`lines.${index}.productId`];
  const qtyError = errors[`lines.${index}.${quantityField}`];
  const costError = errors[`lines.${index}.unitCost`];
  const alreadyStocked = type === 'opening' && known && hasLevel;

  return (
    <TableRow className="align-top">
      <TableCell className="pl-4">
        <ProductPicker
          id={`line-${index}-product`}
          label={`Product for line ${index + 1}`}
          value={line.productId}
          onChange={(productId) => onChange({ productId })}
          activeOnly={type === 'opening'}
          excludeIds={excludeIds}
          invalid={Boolean(productError)}
        />
        {productError ? <p className="text-destructive mt-1 text-xs">{productError}</p> : null}
        {alreadyStocked && !productError ? (
          <p className="mt-1 text-xs text-amber-700">
            Already stocked in this warehouse. Use an adjustment instead.
          </p>
        ) : null}
      </TableCell>
      <TableCell className="pt-4 text-right tabular-nums">
        {known ? `${currentOnHand} ${product.data?.unit ?? ''}` : '—'}
      </TableCell>
      <TableCell>
        <Input
          aria-label={`${counting ? 'Counted quantity' : type === 'opening' ? 'Quantity' : 'Quantity change'} for line ${index + 1}`}
          aria-invalid={qtyError ? true : undefined}
          inputMode="numeric"
          placeholder={type === 'adjustment' && !counting ? 'e.g. -3' : undefined}
          value={line.quantity}
          onChange={(event) => onChange({ quantity: event.target.value })}
        />
        {qtyError ? <p className="text-destructive mt-1 text-xs">{qtyError}</p> : null}
      </TableCell>
      {type === 'opening' ? (
        <TableCell>
          <Input
            aria-label={`Unit cost for line ${index + 1}`}
            aria-invalid={costError ? true : undefined}
            inputMode="decimal"
            placeholder={product.data ? minorToDecimal(product.data.costPrice) : undefined}
            value={line.unitCost}
            onChange={(event) => onChange({ unitCost: event.target.value })}
          />
          {costError ? <p className="text-destructive mt-1 text-xs">{costError}</p> : null}
        </TableCell>
      ) : null}
      <TableCell
        className={cn(
          'pt-4 text-right font-medium tabular-nums',
          after !== null && after < 0 && 'text-destructive',
        )}
      >
        {known && after !== null ? after : '—'}
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
