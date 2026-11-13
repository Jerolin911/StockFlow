import { useState } from 'react';
import { Link } from 'react-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  codeSchema,
  optionalEmail,
  optionalText,
  requiredText,
  type CustomerDto,
  type Permission,
  type SupplierDto,
} from '@stockflow/shared';
import { FilterSelect, SearchInput } from '@/components/filters';
import { FormField, fieldA11y } from '@/components/FormField';
import { DialogActions, FormAlert, FormDialog } from '@/components/form-parts';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { ActiveBadge, StatusBadge } from '@/components/StatusBadge';
import { FilterBar, TableBodyState } from '@/components/table';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DialogFooter } from '@/components/ui/dialog';
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
import { ApiError } from '@/lib/api-client';
import { applyServerErrors } from '@/lib/forms';
import { compact, useUrlFilters } from '@/lib/use-url-filters';
import { useEraseCustomer, usePartners, useSavePartner, type PartnerKind } from './api';

type Partner = SupplierDto | CustomerDto;

interface KindConfig {
  title: string;
  singular: string;
  description: string;
  permission: Permission;
  codeHint: string;
  searchPlaceholder: string;
}

const KINDS: Record<PartnerKind, KindConfig> = {
  suppliers: {
    title: 'Suppliers',
    singular: 'supplier',
    description: 'Companies you buy stock from.',
    permission: 'suppliers:write',
    codeHint: 'Leave blank to generate the next SUP- code.',
    searchPlaceholder: 'Search name, code, contact or email',
  },
  customers: {
    title: 'Customers',
    singular: 'customer',
    description: 'Companies and people you sell to.',
    permission: 'customers:write',
    codeHint: 'Leave blank to generate the next CUS- code.',
    // Personal details are encrypted: an email matches only when typed in full.
    searchPlaceholder: 'Search name, code or full email',
  },
};

const formSchema = z.object({
  code: z.union([z.literal(''), codeSchema(2, 20)]),
  name: requiredText('a name', 150),
  contactName: optionalText(100),
  email: optionalEmail,
  phone: optionalText(40),
  address: optionalText(500),
  notes: optionalText(1000),
  shippingAddress: optionalText(500),
  leadTimeDays: z
    .string()
    .trim()
    .refine((v) => v === '' || (/^\d{1,3}$/.test(v) && Number(v) <= 365), 'Enter 0–365 days'),
  isActive: z.boolean(),
});
type FormValues = z.input<typeof formSchema>;

const isSupplier = (p: Partner): p is SupplierDto => 'leadTimeDays' in p;
const isErased = (p: Partner) => !isSupplier(p) && p.erasedAt !== null;

export function PartnersPage({ kind }: { kind: PartnerKind }) {
  const config = KINDS[kind];
  const canWrite = usePermission(config.permission);
  const canErase = usePermission('customers:erase') && kind === 'customers';
  const filters = useUrlFilters(['search', 'status'] as const);
  const [editing, setEditing] = useState<Partner | null | undefined>(undefined);
  const [erasing, setErasing] = useState<CustomerDto | null>(null);
  const partners = usePartners(kind, {
    ...compact(filters.values),
    page: filters.page,
    pageSize: 20,
  });
  const rows: Partner[] = partners.data?.data ?? [];
  const hasActions = canWrite || canErase;
  const cols = hasActions ? 6 : 5;

  return (
    <>
      <PageHeader
        title={config.title}
        description={config.description}
        actions={
          canWrite ? (
            <Button onClick={() => setEditing(null)}>
              <Plus />
              Add {config.singular}
            </Button>
          ) : null
        }
      />
      <Card className="gap-0 overflow-hidden py-0">
        <FilterBar>
          <SearchInput
            value={filters.values.search}
            onChange={(search) => filters.update({ search })}
            placeholder={config.searchPlaceholder}
            label={`Search ${kind}`}
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
              <TableHead className="hidden md:table-cell">Contact</TableHead>
              <TableHead className="hidden lg:table-cell">
                {kind === 'suppliers' ? 'Lead time' : 'Shipping address'}
              </TableHead>
              <TableHead>Status</TableHead>
              {hasActions ? <TableHead className="w-20 pr-4" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableBodyState
              colSpan={cols}
              isPending={partners.isPending}
              isError={partners.isError}
              isEmpty={rows.length === 0}
              onRetry={() => void partners.refetch()}
              emptyMessage={filters.active ? `No ${kind} match these filters.` : `No ${kind} yet.`}
            >
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="pl-4 font-mono text-xs font-medium">{p.code}</TableCell>
                  <TableCell>
                    {kind === 'suppliers' ? (
                      <Link to={`/suppliers/${p.id}`} className="font-medium hover:underline">
                        {p.name}
                      </Link>
                    ) : (
                      <Link
                        to={`/sales-orders?customerId=${p.id}`}
                        className="font-medium hover:underline"
                        title="Order history"
                      >
                        {p.name}
                      </Link>
                    )}
                    {p.contactName ? (
                      <div className="text-muted-foreground text-xs">{p.contactName}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="text-sm">{p.email || '—'}</div>
                    {p.phone ? (
                      <div className="text-muted-foreground text-xs">{p.phone}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden max-w-xs truncate lg:table-cell">
                    {isSupplier(p)
                      ? p.leadTimeDays === null
                        ? '—'
                        : `${p.leadTimeDays} day${p.leadTimeDays === 1 ? '' : 's'}`
                      : p.shippingAddress || '—'}
                  </TableCell>
                  <TableCell>
                    {isErased(p) ? (
                      <StatusBadge tone="gray">Erased</StatusBadge>
                    ) : (
                      <ActiveBadge active={p.isActive} />
                    )}
                  </TableCell>
                  {hasActions ? (
                    <TableCell className="pr-4 text-right whitespace-nowrap">
                      {canWrite && !isErased(p) ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing(p)}
                          aria-label={`Edit ${p.name}`}
                        >
                          Edit
                        </Button>
                      ) : null}
                      {canErase && !isSupplier(p) && !isErased(p) ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setErasing(p)}
                          aria-label={`Erase personal data of ${p.name}`}
                        >
                          Erase
                        </Button>
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBodyState>
          </TableBody>
        </Table>
        {partners.data && partners.data.meta.total > 0 ? (
          <Pagination
            meta={partners.data.meta}
            onPageChange={(page) => filters.update({ page: String(page) })}
          />
        ) : null}
      </Card>

      <FormDialog
        open={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
        title={editing ? `Edit ${config.singular}` : `Add ${config.singular}`}
        wide
      >
        <PartnerForm kind={kind} partner={editing ?? null} onDone={() => setEditing(undefined)} />
      </FormDialog>

      <FormDialog
        open={erasing !== null}
        onOpenChange={(open) => !open && setErasing(null)}
        title="Erase personal data"
        description="Destroys this customer's encryption key. Their contact details, notes and the delivery addresses on past orders and shipments become permanently unreadable, including in backups. Orders, shipments and stock history are kept under the business name and code. This can't be undone."
      >
        {erasing ? <EraseCustomerForm customer={erasing} onDone={() => setErasing(null)} /> : null}
      </FormDialog>
    </>
  );
}

function PartnerForm({
  kind,
  partner,
  onDone,
}: {
  kind: PartnerKind;
  partner: Partner | null;
  onDone: () => void;
}) {
  const config = KINDS[kind];
  const save = useSavePartner(kind);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      code: partner?.code ?? '',
      name: partner?.name ?? '',
      contactName: partner?.contactName ?? '',
      email: partner?.email ?? '',
      phone: partner?.phone ?? '',
      address: partner?.address ?? '',
      notes: partner?.notes ?? '',
      shippingAddress: partner && !isSupplier(partner) ? partner.shippingAddress : '',
      leadTimeDays:
        partner && isSupplier(partner) && partner.leadTimeDays !== null
          ? String(partner.leadTimeDays)
          : '',
      isActive: partner?.isActive ?? true,
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const { code, leadTimeDays, shippingAddress, isActive, ...common } = values;
    const extra =
      kind === 'suppliers'
        ? { leadTimeDays: leadTimeDays.trim() === '' ? null : Number(leadTimeDays) }
        : { shippingAddress };
    try {
      await save.mutateAsync(
        partner ? { id: partner.id, ...common, ...extra, isActive } : { code, ...common, ...extra },
      );
      toast.success(partner ? 'Changes saved' : `${values.name.trim()} added`);
      onDone();
    } catch (error) {
      setFormError(
        applyServerErrors(error, setError, [
          'code',
          'name',
          'contactName',
          'email',
          'phone',
          'address',
          'notes',
          'shippingAddress',
          'leadTimeDays',
        ]),
      );
    }
  });

  const field = (id: keyof FormValues) => fieldA11y(`p-${id}`, errors[id]?.message);

  return (
    <>
      <form id="partner-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormAlert message={formError} />
        </div>
        <FormField
          id="p-code"
          label="Code"
          error={errors.code?.message}
          {...(partner ? { hint: "Codes can't be changed." } : { hint: config.codeHint })}
        >
          <Input
            {...field('code')}
            className="uppercase"
            disabled={partner !== null}
            {...register('code')}
          />
        </FormField>
        <FormField id="p-name" label="Name" error={errors.name?.message}>
          <Input {...field('name')} {...register('name')} />
        </FormField>
        <FormField id="p-contactName" label="Contact person" error={errors.contactName?.message}>
          <Input {...field('contactName')} {...register('contactName')} />
        </FormField>
        <FormField id="p-email" label="Email" error={errors.email?.message}>
          <Input {...field('email')} type="email" {...register('email')} />
        </FormField>
        <FormField id="p-phone" label="Phone" error={errors.phone?.message}>
          <Input {...field('phone')} type="tel" {...register('phone')} />
        </FormField>
        {kind === 'suppliers' ? (
          <FormField
            id="p-leadTimeDays"
            label="Lead time (days)"
            error={errors.leadTimeDays?.message}
          >
            <Input {...field('leadTimeDays')} inputMode="numeric" {...register('leadTimeDays')} />
          </FormField>
        ) : (
          <div className="hidden sm:block" />
        )}
        <FormField id="p-address" label="Address" error={errors.address?.message}>
          <Textarea {...field('address')} rows={2} {...register('address')} />
        </FormField>
        {kind === 'customers' ? (
          <FormField
            id="p-shippingAddress"
            label="Shipping address"
            error={errors.shippingAddress?.message}
          >
            <Textarea {...field('shippingAddress')} rows={2} {...register('shippingAddress')} />
          </FormField>
        ) : (
          <div className="hidden sm:block" />
        )}
        <div className="sm:col-span-2">
          <FormField id="p-notes" label="Notes" error={errors.notes?.message}>
            <Textarea {...field('notes')} rows={2} {...register('notes')} />
          </FormField>
        </div>
        {partner ? (
          <Controller
            control={control}
            name="isActive"
            render={({ field: f }) => (
              <div className="flex items-center gap-3 sm:col-span-2">
                <Switch id="p-active" checked={f.value} onCheckedChange={f.onChange} />
                <label htmlFor="p-active" className="text-sm font-medium">
                  Active
                </label>
              </div>
            )}
          />
        ) : null}
      </form>
      <DialogActions
        formId="partner-form"
        submitLabel={partner ? 'Save changes' : `Add ${config.singular}`}
        pending={isSubmitting}
        onCancel={onDone}
      />
    </>
  );
}

function EraseCustomerForm({ customer, onDone }: { customer: CustomerDto; onDone: () => void }) {
  const erase = useEraseCustomer();
  const [reason, setReason] = useState('');
  const [confirmCode, setConfirmCode] = useState('');
  const [errors, setErrors] = useState<{ reason?: string; confirmCode?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async () => {
    const found = {
      ...(reason.trim() ? {} : { reason: 'Enter the reason for erasing' }),
      ...(confirmCode.trim().toUpperCase() === customer.code
        ? {}
        : { confirmCode: `Type ${customer.code} to confirm` }),
    };
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setFormError(null);
    try {
      await erase.mutateAsync({ id: customer.id, reason: reason.trim(), confirmCode });
      toast.success(`Personal data of ${customer.name} erased`);
      onDone();
    } catch (error) {
      const details = error instanceof ApiError ? error.details : [];
      const fieldErrors = Object.fromEntries(
        details
          .filter((d) => d.path === 'reason' || d.path === 'confirmCode')
          .map((d) => [d.path, d.message]),
      );
      setErrors(fieldErrors);
      if (Object.keys(fieldErrors).length === 0) {
        setFormError(
          error instanceof ApiError ? error.message : 'Something went wrong. Try again.',
        );
      }
    }
  };

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <FormAlert message={formError} />
      <FormField id="erase-reason" label="Reason" error={errors.reason}>
        <Textarea
          {...fieldA11y('erase-reason', errors.reason)}
          rows={2}
          maxLength={500}
          placeholder="For example: erasure request from the customer by email"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </FormField>
      <FormField
        id="erase-code"
        label={`Type ${customer.code} to confirm`}
        error={errors.confirmCode}
      >
        <Input
          {...fieldA11y('erase-code', errors.confirmCode)}
          className="font-mono uppercase"
          autoComplete="off"
          value={confirmCode}
          onChange={(event) => setConfirmCode(event.target.value)}
        />
      </FormField>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={erase.isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="destructive" disabled={erase.isPending}>
          {erase.isPending ? <Loader2 className="animate-spin" /> : null}
          Erase personal data
        </Button>
      </DialogFooter>
    </form>
  );
}
