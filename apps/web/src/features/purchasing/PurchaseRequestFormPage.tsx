import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { PurchaseRequestDto } from '@stockflow/shared';
import { BackLink } from '@/components/BackLink';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useWarehouseOptions } from '@/features/catalog/api';
import { usePartners } from '@/features/partners/api';
import { ApiError } from '@/lib/api-client';
import { usePurchaseRequest, usePurchaseRequestAction, useSavePurchaseRequest } from './api';
import {
  LinesEditor,
  newEditorLine,
  validateLines,
  type EditorLine,
  type LineErrors,
} from './LinesEditor';

const NO_SUPPLIER = '__none__';

export function PurchaseRequestFormPage() {
  const { id } = useParams<{ id: string }>();
  const existing = usePurchaseRequest(id);
  if (id && !existing.data) {
    return existing.isError ? (
      <p className="text-destructive text-sm">Couldn't load this request.</p>
    ) : (
      <Skeleton className="h-64 w-full" />
    );
  }
  return <RequestForm key={id ?? 'new'} request={existing.data ?? null} />;
}

function RequestForm({ request }: { request: PurchaseRequestDto | null }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const warehouses = useWarehouseOptions();
  const suppliers = usePartners('suppliers', { status: 'active', pageSize: 100 });
  const save = useSavePurchaseRequest();
  const action = usePurchaseRequestAction();

  const [warehouseId, setWarehouseId] = useState(
    request?.warehouse.id ?? params.get('warehouseId') ?? '',
  );
  const [supplierId, setSupplierId] = useState(request?.supplier?.id ?? '');
  const [neededBy, setNeededBy] = useState(request?.neededBy ?? '');
  const [notes, setNotes] = useState(request?.notes ?? '');
  const [lines, setLines] = useState<EditorLine[]>(() =>
    request
      ? request.lines.map((l) =>
          newEditorLine({ productId: l.productId, quantity: String(l.quantity), note: l.note }),
        )
      : [
          newEditorLine({
            productId: params.get('productId') ?? '',
            quantity: params.get('quantity') ?? '',
          }),
        ],
  );
  const [errors, setErrors] = useState<LineErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState<'draft' | 'submit' | null>(null);

  const submit = async (andSubmit: boolean) => {
    setFormError(null);
    const issues = validateLines(lines, 'request');
    if (!warehouseId) issues.warehouseId = 'Select a warehouse';
    setErrors(issues);
    if (Object.keys(issues).length > 0) return;

    setPending(andSubmit ? 'submit' : 'draft');
    try {
      const saved = await save.mutateAsync({
        ...(request ? { id: request.id } : {}),
        warehouseId,
        supplierId: supplierId || null,
        neededBy: neededBy || null,
        notes,
        lines: lines.map((l) => ({
          productId: l.productId,
          quantity: Number(l.quantity),
          note: l.note,
        })),
      });
      if (andSubmit) await action.mutateAsync({ id: saved.id, action: 'submit' });
      toast.success(
        andSubmit ? `${saved.number} submitted for approval` : `${saved.number} saved as draft`,
      );
      void navigate(`/purchase-requests/${saved.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.details.length > 0) {
        setErrors(Object.fromEntries(error.details.map((d) => [d.path, d.message])));
      }
      setFormError(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <BackLink
        to={request ? `/purchase-requests/${request.id}` : '/purchase-requests'}
        label={request ? request.number : 'Purchase requests'}
      />
      <PageHeader
        title={request ? `Edit ${request.number}` : 'New purchase request'}
        description="Ask for stock to be ordered. An approver reviews it before purchasing creates an order."
      />
      <form
        noValidate
        className="grid gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(true);
        }}
      >
        <FormAlert message={formError} />
        <Card>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FormField id="pr-warehouse" label="Deliver to" error={errors.warehouseId}>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger
                  {...fieldA11y('pr-warehouse', errors.warehouseId)}
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
            <FormField id="pr-needed" label="Needed by" error={errors.neededBy}>
              <Input
                {...fieldA11y('pr-needed', errors.neededBy)}
                type="date"
                value={neededBy}
                onChange={(event) => setNeededBy(event.target.value)}
              />
            </FormField>
            <FormField id="pr-supplier" label="Preferred supplier" error={errors.supplierId}>
              <Select
                value={supplierId || NO_SUPPLIER}
                onValueChange={(v) => setSupplierId(v === NO_SUPPLIER ? '' : v)}
              >
                <SelectTrigger {...fieldA11y('pr-supplier', errors.supplierId)} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SUPPLIER}>No preference</SelectItem>
                  {(suppliers.data?.data ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <div className="sm:col-span-2 lg:col-span-3">
              <FormField id="pr-notes" label="Reason or notes" error={errors.notes}>
                <Textarea
                  {...fieldA11y('pr-notes', errors.notes)}
                  rows={2}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </FormField>
            </div>
          </CardContent>
        </Card>

        <LinesEditor mode="request" lines={lines} onChange={setLines} errors={errors} />

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending !== null}>
            {pending === 'submit' ? <Loader2 className="animate-spin" /> : null}
            Submit for approval
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending !== null}
            onClick={() => void submit(false)}
          >
            {pending === 'draft' ? <Loader2 className="animate-spin" /> : null}
            Save as draft
          </Button>
        </div>
      </form>
    </>
  );
}
