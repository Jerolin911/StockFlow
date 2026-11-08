import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { createWarehouseSchema, type WarehouseDto } from '@stockflow/shared';
import { FilterSelect, SearchInput } from '@/components/filters';
import { FormField, fieldA11y } from '@/components/FormField';
import { DialogActions, FormAlert, FormDialog } from '@/components/form-parts';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { ActiveBadge } from '@/components/StatusBadge';
import { FilterBar, TableBodyState } from '@/components/table';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { usePermission } from '@/features/auth/auth-context';
import { applyServerErrors } from '@/lib/forms';
import { compact, useUrlFilters } from '@/lib/use-url-filters';
import { useCreateWarehouse, useUpdateWarehouse, useWarehouses } from './api';

const formSchema = createWarehouseSchema.extend({ isActive: z.boolean() });
type FormValues = z.input<typeof formSchema>;

export function WarehousesPage() {
  const canManage = usePermission('warehouses:manage');
  const filters = useUrlFilters(['search', 'status'] as const);
  const [editing, setEditing] = useState<WarehouseDto | null | undefined>(undefined);
  const warehouses = useWarehouses({
    ...compact(filters.values),
    page: filters.page,
    pageSize: 20,
  });
  const rows = warehouses.data?.data ?? [];
  const cols = canManage ? 6 : 5;

  return (
    <>
      <PageHeader
        title="Warehouses"
        description="Locations where stock is held."
        actions={
          canManage ? (
            <Button onClick={() => setEditing(null)}>
              <Plus />
              Add warehouse
            </Button>
          ) : null
        }
      />
      <Card className="gap-0 overflow-hidden py-0">
        <FilterBar>
          <SearchInput
            value={filters.values.search}
            onChange={(search) => filters.update({ search })}
            placeholder="Search code or name"
            label="Search warehouses"
          />
          <FilterSelect
            label="Filter by status"
            value={filters.values.status}
            onChange={(status) => filters.update({ status })}
            allLabel="All statuses"
            options={[
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ]}
          />
        </FilterBar>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Products in stock</TableHead>
              <TableHead className="text-right">Units on hand</TableHead>
              <TableHead>Status</TableHead>
              {canManage ? <TableHead className="w-20 pr-4" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableBodyState
              colSpan={cols}
              isPending={warehouses.isPending}
              isError={warehouses.isError}
              isEmpty={rows.length === 0}
              onRetry={() => void warehouses.refetch()}
              emptyMessage={
                filters.active ? 'No warehouses match these filters.' : 'No warehouses yet.'
              }
            >
              {rows.map((w) => (
                <TableRow key={w.id}>
                  <TableCell className="pl-4 font-mono text-xs font-medium">{w.code}</TableCell>
                  <TableCell>
                    <div className="font-medium">{w.name}</div>
                    {w.address ? (
                      <div className="text-muted-foreground max-w-xs truncate text-xs">
                        {w.address}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Link
                      to={`/stock?warehouseId=${w.id}`}
                      className="hover:underline"
                      aria-label={`View stock in ${w.name}`}
                    >
                      {w.stock.skuCount}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {w.stock.onHand.toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <ActiveBadge active={w.isActive} />
                  </TableCell>
                  {canManage ? (
                    <TableCell className="pr-4 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(w)}
                        aria-label={`Edit ${w.name}`}
                      >
                        Edit
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBodyState>
          </TableBody>
        </Table>
        {warehouses.data && warehouses.data.meta.total > 0 ? (
          <Pagination
            meta={warehouses.data.meta}
            onPageChange={(page) => filters.update({ page: String(page) })}
          />
        ) : null}
      </Card>

      <FormDialog
        open={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
        title={editing ? 'Edit warehouse' : 'Add warehouse'}
      >
        <WarehouseForm warehouse={editing ?? null} onDone={() => setEditing(undefined)} />
      </FormDialog>
    </>
  );
}

function WarehouseForm({
  warehouse,
  onDone,
}: {
  warehouse: WarehouseDto | null;
  onDone: () => void;
}) {
  const create = useCreateWarehouse();
  const update = useUpdateWarehouse();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: warehouse
      ? {
          code: warehouse.code,
          name: warehouse.name,
          address: warehouse.address,
          isActive: warehouse.isActive,
        }
      : { code: '', name: '', address: '', isActive: true },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (warehouse) {
        await update.mutateAsync({ id: warehouse.id, ...values });
        toast.success('Warehouse saved');
      } else {
        const { isActive: _isActive, ...input } = values;
        await create.mutateAsync(input);
        toast.success(`${values.name} added`);
      }
      onDone();
    } catch (error) {
      setFormError(applyServerErrors(error, setError, ['code', 'name', 'address', 'isActive']));
    }
  });

  return (
    <>
      <form id="warehouse-form" onSubmit={onSubmit} noValidate className="grid gap-4">
        <FormAlert message={formError} />
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField id="wh-code" label="Code" error={errors.code?.message}>
            <Input
              {...fieldA11y('wh-code', errors.code?.message)}
              className="uppercase"
              {...register('code')}
            />
          </FormField>
          <div className="sm:col-span-2">
            <FormField id="wh-name" label="Name" error={errors.name?.message}>
              <Input {...fieldA11y('wh-name', errors.name?.message)} {...register('name')} />
            </FormField>
          </div>
        </div>
        <FormField id="wh-address" label="Address" error={errors.address?.message}>
          <Textarea
            {...fieldA11y('wh-address', errors.address?.message)}
            rows={2}
            {...register('address')}
          />
        </FormField>
        {warehouse ? (
          <Controller
            control={control}
            name="isActive"
            render={({ field }) => (
              <div className="flex items-start gap-3">
                <Switch id="wh-active" checked={field.value} onCheckedChange={field.onChange} />
                <div className="grid gap-0.5">
                  <label htmlFor="wh-active" className="text-sm font-medium">
                    Active
                  </label>
                  <p className="text-muted-foreground text-xs">
                    Inactive warehouses can't receive stock. A warehouse must be empty to deactivate
                    it.
                  </p>
                </div>
              </div>
            )}
          />
        ) : null}
      </form>
      <DialogActions
        formId="warehouse-form"
        submitLabel={warehouse ? 'Save changes' : 'Add warehouse'}
        pending={isSubmitting}
        onCancel={onDone}
      />
    </>
  );
}
