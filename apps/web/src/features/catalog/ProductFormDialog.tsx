import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  UNITS,
  basisPointsToPercent,
  minorToDecimal,
  optionalText,
  parseMoney,
  parsePercent,
  requiredText,
  skuSchema,
  type ProductDto,
} from '@stockflow/shared';
import { FormField, fieldA11y } from '@/components/FormField';
import { DialogActions, FormAlert, FormDialog } from '@/components/form-parts';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { applyServerErrors } from '@/lib/forms';
import { useCategoryOptions, useCreateProduct, useUpdateProduct } from './api';

const moneyText = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `Enter ${label}`)
    .refine((v) => parseMoney(v) !== null, 'Enter an amount such as 12.50');

const wholeNumber = z
  .string()
  .trim()
  .refine((v) => v === '' || /^\d{1,9}$/.test(v), 'Enter a whole number');

const formSchema = z.object({
  name: requiredText('a product name', 150),
  sku: z.union([z.literal(''), skuSchema]),
  categoryId: z.string().min(1, 'Select a category'),
  unit: z.enum(UNITS, 'Select a unit'),
  barcode: z
    .string()
    .trim()
    .max(64)
    .regex(/^[A-Za-z0-9-]*$/, 'Use letters, numbers or dashes'),
  description: optionalText(1000),
  costPrice: moneyText('a cost price'),
  sellingPrice: moneyText('a selling price'),
  taxRate: z
    .string()
    .trim()
    .refine((v) => v === '' || parsePercent(v) !== null, 'Enter a rate from 0 to 100'),
  reorderPoint: wholeNumber,
  reorderQuantity: wholeNumber,
  isActive: z.boolean(),
});
type FormValues = z.input<typeof formSchema>;

const SERVER_FIELDS = [
  'name',
  'sku',
  'categoryId',
  'unit',
  'barcode',
  'description',
  'costPrice',
  'sellingPrice',
  'taxRate',
  'reorderPoint',
  'reorderQuantity',
] as const;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: ProductDto | null;
}

export function ProductFormDialog({ open, onOpenChange, product }: Props) {
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={product ? 'Edit product' : 'Add product'}
      wide
    >
      <ProductForm product={product} onDone={() => onOpenChange(false)} />
    </FormDialog>
  );
}

function ProductForm({ product, onDone }: { product: ProductDto | null; onDone: () => void }) {
  const navigate = useNavigate();
  const categories = useCategoryOptions();
  const create = useCreateProduct();
  const update = useUpdateProduct();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: product
      ? {
          name: product.name,
          sku: product.sku,
          categoryId: product.category?.id ?? '',
          unit: product.unit,
          barcode: product.barcode,
          description: product.description,
          costPrice: minorToDecimal(product.costPrice),
          sellingPrice: minorToDecimal(product.sellingPrice),
          taxRate: basisPointsToPercent(product.taxRate),
          reorderPoint: String(product.reorderPoint),
          reorderQuantity: String(product.reorderQuantity),
          isActive: product.isActive,
        }
      : {
          name: '',
          sku: '',
          categoryId: '',
          unit: 'pcs',
          barcode: '',
          description: '',
          costPrice: '',
          sellingPrice: '',
          taxRate: '0',
          reorderPoint: '0',
          reorderQuantity: '0',
          isActive: true,
        },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const fields = {
      name: values.name,
      categoryId: values.categoryId,
      unit: values.unit,
      barcode: values.barcode,
      description: values.description,
      costPrice: parseMoney(values.costPrice)!,
      sellingPrice: parseMoney(values.sellingPrice)!,
      taxRate: values.taxRate === '' ? 0 : parsePercent(values.taxRate)!,
      reorderPoint: Number(values.reorderPoint || 0),
      reorderQuantity: Number(values.reorderQuantity || 0),
    };
    try {
      if (product) {
        await update.mutateAsync({ id: product.id, ...fields, isActive: values.isActive });
        toast.success('Product saved');
        onDone();
      } else {
        const created = await create.mutateAsync({ ...fields, sku: values.sku });
        toast.success(`${created.name} added as ${created.sku}`);
        onDone();
        void navigate(`/products/${created.id}`);
      }
    } catch (error) {
      setFormError(applyServerErrors(error, setError, SERVER_FIELDS));
    }
  });

  const a11y = (id: keyof FormValues, hint?: string) =>
    fieldA11y(`prod-${id}`, errors[id]?.message, hint);

  return (
    <>
      <form id="product-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormAlert message={formError} />
        </div>
        <div className="sm:col-span-2">
          <FormField id="prod-name" label="Product name" error={errors.name?.message}>
            <Input {...a11y('name')} {...register('name')} />
          </FormField>
        </div>
        <FormField
          id="prod-sku"
          label="SKU"
          error={errors.sku?.message}
          hint={
            product ? "SKUs can't be changed." : 'Leave blank to generate from the category code.'
          }
        >
          <Input
            {...a11y('sku', 'hint')}
            className="font-mono uppercase"
            disabled={product !== null}
            {...register('sku')}
          />
        </FormField>
        <FormField id="prod-barcode" label="Barcode" error={errors.barcode?.message}>
          <Input {...a11y('barcode')} className="font-mono" {...register('barcode')} />
        </FormField>
        <FormField id="prod-categoryId" label="Category" error={errors.categoryId?.message}>
          <Controller
            control={control}
            name="categoryId"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger {...a11y('categoryId')} className="w-full" onBlur={field.onBlur}>
                  <SelectValue
                    placeholder={categories.isPending ? 'Loading…' : 'Select a category'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(categories.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} ({c.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </FormField>
        <FormField id="prod-unit" label="Unit" error={errors.unit?.message}>
          <Controller
            control={control}
            name="unit"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger {...a11y('unit')} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNITS.map((unit) => (
                    <SelectItem key={unit} value={unit}>
                      {unit}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </FormField>
        <FormField id="prod-costPrice" label="Cost price" error={errors.costPrice?.message}>
          <Input {...a11y('costPrice')} inputMode="decimal" {...register('costPrice')} />
        </FormField>
        <FormField
          id="prod-sellingPrice"
          label="Selling price"
          error={errors.sellingPrice?.message}
        >
          <Input {...a11y('sellingPrice')} inputMode="decimal" {...register('sellingPrice')} />
        </FormField>
        <FormField id="prod-taxRate" label="Tax rate (%)" error={errors.taxRate?.message}>
          <Input {...a11y('taxRate')} inputMode="decimal" {...register('taxRate')} />
        </FormField>
        <div className="hidden sm:block" />
        <FormField
          id="prod-reorderPoint"
          label="Low-stock threshold"
          error={errors.reorderPoint?.message}
          hint="Per warehouse. 0 turns alerts off."
        >
          <Input
            {...a11y('reorderPoint', 'hint')}
            inputMode="numeric"
            {...register('reorderPoint')}
          />
        </FormField>
        <FormField
          id="prod-reorderQuantity"
          label="Reorder quantity"
          error={errors.reorderQuantity?.message}
          hint="Suggested quantity when restocking."
        >
          <Input
            {...a11y('reorderQuantity', 'hint')}
            inputMode="numeric"
            {...register('reorderQuantity')}
          />
        </FormField>
        <div className="sm:col-span-2">
          <FormField id="prod-description" label="Description" error={errors.description?.message}>
            <Textarea {...a11y('description')} rows={3} {...register('description')} />
          </FormField>
        </div>
        {product ? (
          <Controller
            control={control}
            name="isActive"
            render={({ field }) => (
              <div className="flex items-start gap-3 sm:col-span-2">
                <Switch id="prod-active" checked={field.value} onCheckedChange={field.onChange} />
                <div className="grid gap-0.5">
                  <label htmlFor="prod-active" className="text-sm font-medium">
                    Active
                  </label>
                  <p className="text-muted-foreground text-xs">
                    Inactive products keep their stock and history but can't receive opening stock.
                  </p>
                </div>
              </div>
            )}
          />
        ) : null}
      </form>
      <DialogActions
        formId="product-form"
        submitLabel={product ? 'Save changes' : 'Add product'}
        pending={isSubmitting}
        onCancel={onDone}
      />
    </>
  );
}
