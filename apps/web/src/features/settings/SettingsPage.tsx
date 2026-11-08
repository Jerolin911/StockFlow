import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { type z } from 'zod';
import { CURRENCIES, updateSettingsSchema, type SettingsDto } from '@stockflow/shared';
import { FormField, fieldA11y } from '@/components/FormField';
import { FormAlert } from '@/components/form-parts';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { applyServerErrors } from '@/lib/forms';
import { useSettings, useUpdateSettings } from './api';

const formSchema = updateSettingsSchema.required();
type FormValues = z.infer<typeof formSchema>;

const currencyName = new Intl.DisplayNames(undefined, { type: 'currency' });

export function SettingsPage() {
  const settings = useSettings();
  return (
    <>
      <PageHeader title="Settings" description="Workspace details used across StockFlow." />
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
        </CardHeader>
        <CardContent>
          {settings.data ? (
            <SettingsForm settings={settings.data} />
          ) : settings.isError ? (
            <p className="text-destructive text-sm">Couldn't load settings.</p>
          ) : (
            <Skeleton className="h-32 w-full" />
          )}
        </CardContent>
      </Card>
    </>
  );
}

function SettingsForm({ settings }: { settings: SettingsDto }) {
  const update = useUpdateSettings();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: settings });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const saved = await update.mutateAsync(values);
      reset(saved);
      toast.success('Settings saved');
    } catch (error) {
      setFormError(applyServerErrors(error, setError, ['companyName', 'currency']));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <FormAlert message={formError} />
      <FormField id="companyName" label="Company name" error={errors.companyName?.message}>
        <Input
          {...fieldA11y('companyName', errors.companyName?.message)}
          {...register('companyName')}
        />
      </FormField>
      <FormField
        id="currency"
        label="Currency"
        error={errors.currency?.message}
        hint="Used to display prices and costs. Changing it doesn't convert existing amounts."
      >
        <Controller
          control={control}
          name="currency"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger
                {...fieldA11y('currency', errors.currency?.message)}
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {code} — {currencyName.of(code)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </FormField>
      <div>
        <Button type="submit" disabled={isSubmitting || !isDirty}>
          {isSubmitting ? <Loader2 className="animate-spin" /> : null}
          Save changes
        </Button>
      </div>
    </form>
  );
}
