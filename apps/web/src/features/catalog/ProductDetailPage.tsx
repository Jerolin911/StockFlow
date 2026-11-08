import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, Pencil, SlidersHorizontal, PackagePlus } from 'lucide-react';
import { toast } from 'sonner';
import { basisPointsToPercent, type StockLevelDto } from '@stockflow/shared';
import { DialogActions, FormAlert, FormDialog } from '@/components/form-parts';
import { FormField, fieldA11y } from '@/components/FormField';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge, StockBadge } from '@/components/StatusBadge';
import { NotFoundPage } from '@/components/StatusPages';
import { TableBodyState } from '@/components/table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usePermission } from '@/features/auth/auth-context';
import { useMoney } from '@/features/settings/api';
import { useMovements, useStockLevels, useUpdateThreshold } from '@/features/stock/api';
import { MovementsTable } from '@/features/stock/MovementsTable';
import { ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { useProduct } from './api';
import { ProductFormDialog } from './ProductFormDialog';

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const product = useProduct(id);
  const canWrite = usePermission('products:write');
  const canAdjust = usePermission('stock:adjust');
  const money = useMoney();
  const [editing, setEditing] = useState(false);
  const [thresholdLevel, setThresholdLevel] = useState<StockLevelDto | null>(null);
  const levels = useStockLevels({ productId: id, pageSize: 100 }, Boolean(id));
  const movements = useMovements({ productId: id, pageSize: 10 });

  if (product.isError && product.error instanceof ApiError && product.error.status === 404) {
    return <NotFoundPage />;
  }
  if (!product.data) {
    return product.isError ? (
      <p className="text-destructive text-sm">Couldn't load this product.</p>
    ) : (
      <Skeleton className="h-64 w-full" />
    );
  }

  const p = product.data;

  return (
    <>
      <Link
        to="/products"
        className="text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" />
        Products
      </Link>
      <PageHeader
        title={p.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{p.sku}</span>
            {p.isActive ? null : <StatusBadge tone="gray">Inactive</StatusBadge>}
            <StockBadge available={p.stock.available} isLow={p.stock.lowStockWarehouses > 0} />
          </span>
        }
        actions={
          <>
            {canAdjust ? (
              <>
                <Button variant="outline" asChild>
                  <Link to={`/stock/adjustments/new?type=opening&productId=${p.id}`}>
                    <PackagePlus />
                    Opening stock
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link to={`/stock/adjustments/new?type=adjustment&productId=${p.id}`}>
                    <SlidersHorizontal />
                    Adjust stock
                  </Link>
                </Button>
              </>
            ) : null}
            {canWrite ? (
              <Button onClick={() => setEditing(true)}>
                <Pencil />
                Edit
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-sm">
              <Detail label="Category">
                {p.category ? `${p.category.name} (${p.category.code})` : '—'}
              </Detail>
              <Detail label="Unit">{p.unit}</Detail>
              <Detail label="Barcode">{p.barcode || '—'}</Detail>
              <Detail label="Selling price">{money(p.sellingPrice)}</Detail>
              <Detail label="Cost price">{money(p.costPrice)}</Detail>
              <Detail label="Average cost">{p.stock.onHand > 0 ? money(p.avgCost) : '—'}</Detail>
              <Detail label="Tax rate">{basisPointsToPercent(p.taxRate)}%</Detail>
              <Detail label="Low-stock threshold">
                {p.reorderPoint > 0 ? p.reorderPoint : 'Off'}
              </Detail>
              <Detail label="Reorder quantity">{p.reorderQuantity}</Detail>
              <Detail label="Updated">{formatDateTime(p.updatedAt)}</Detail>
            </dl>
            {p.description ? (
              <p className="text-muted-foreground mt-4 border-t pt-4 text-sm whitespace-pre-line">
                {p.description}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="gap-0 overflow-hidden pb-0 lg:col-span-2">
          <CardHeader className="pb-4">
            <CardTitle>Stock by warehouse</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Warehouse</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="text-right">Reserved</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead className="text-right">Threshold</TableHead>
                <TableHead className="pr-6">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableBodyState
                colSpan={6}
                isPending={levels.isPending}
                isError={levels.isError}
                isEmpty={(levels.data?.data.length ?? 0) === 0}
                onRetry={() => void levels.refetch()}
                emptyMessage="Not stocked in any warehouse yet. Register opening stock to start tracking it."
              >
                {(levels.data?.data ?? []).map((level) => (
                  <TableRow key={level.id}>
                    <TableCell className="pl-6">
                      <span className="font-mono text-xs">{level.warehouse.code}</span>{' '}
                      <span className="text-muted-foreground">{level.warehouse.name}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{level.onHand}</TableCell>
                    <TableCell className="text-right tabular-nums">{level.reserved}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {level.available}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {canWrite ? (
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto p-0"
                          onClick={() => setThresholdLevel(level)}
                          aria-label={`Change threshold for ${level.warehouse.name}`}
                        >
                          {level.reorderPoint > 0 ? level.reorderPoint : 'Off'}
                          {level.reorderPointOverride !== null ? '*' : ''}
                        </Button>
                      ) : level.reorderPoint > 0 ? (
                        level.reorderPoint
                      ) : (
                        'Off'
                      )}
                    </TableCell>
                    <TableCell className="pr-6">
                      <StockBadge available={level.available} isLow={level.isLow} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBodyState>
            </TableBody>
          </Table>
          {levels.data?.data.some((l) => l.reorderPointOverride !== null) ? (
            <p className="text-muted-foreground border-t px-6 py-3 text-xs">
              * Threshold set for this warehouse instead of the product default.
            </p>
          ) : null}
        </Card>
      </div>

      <Card className="mt-6 gap-0 overflow-hidden pb-0">
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <CardTitle>Recent movements</CardTitle>
          <Button variant="link" size="sm" asChild className="h-auto p-0">
            <Link to={`/stock/movements?productId=${p.id}`}>View all</Link>
          </Button>
        </CardHeader>
        <MovementsTable
          rows={movements.data?.data ?? []}
          isPending={movements.isPending}
          isError={movements.isError}
          onRetry={() => void movements.refetch()}
          emptyMessage="No stock movements yet."
          showProduct={false}
        />
      </Card>

      <ProductFormDialog open={editing} onOpenChange={setEditing} product={p} />
      <FormDialog
        open={thresholdLevel !== null}
        onOpenChange={(open) => !open && setThresholdLevel(null)}
        title="Low-stock threshold"
        description={
          thresholdLevel
            ? `For ${p.sku} in ${thresholdLevel.warehouse.name}. The product default is ${p.reorderPoint > 0 ? p.reorderPoint : 'off'}.`
            : undefined
        }
      >
        {thresholdLevel ? (
          <ThresholdForm level={thresholdLevel} onDone={() => setThresholdLevel(null)} />
        ) : null}
      </FormDialog>
    </>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

function ThresholdForm({ level, onDone }: { level: StockLevelDto; onDone: () => void }) {
  const update = useUpdateThreshold();
  const [value, setValue] = useState(
    level.reorderPointOverride === null ? '' : String(level.reorderPointOverride),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const save = async (reorderPoint: number | null) => {
    setPending(true);
    setError(null);
    try {
      await update.mutateAsync({ id: level.id, reorderPoint });
      toast.success('Threshold updated');
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the threshold');
    } finally {
      setPending(false);
    }
  };

  const invalid = value.trim() !== '' && !/^\d{1,9}$/.test(value.trim());

  return (
    <>
      <form
        id="threshold-form"
        noValidate
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!invalid) void save(value.trim() === '' ? null : Number(value));
        }}
      >
        <FormAlert message={error} />
        <FormField
          id="threshold"
          label="Threshold for this warehouse"
          error={invalid ? 'Enter a whole number' : undefined}
          hint="Leave blank to use the product default. 0 turns alerts off here."
        >
          <Input
            {...fieldA11y('threshold', invalid ? 'invalid' : undefined, 'hint')}
            inputMode="numeric"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            autoFocus
          />
        </FormField>
      </form>
      <DialogActions
        formId="threshold-form"
        submitLabel="Save"
        pending={pending}
        onCancel={onDone}
      />
    </>
  );
}
