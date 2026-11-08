import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router';
import { AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { changePasswordSchema, type UserDto } from '@stockflow/shared';
import { FormField, fieldA11y } from '@/components/FormField';
import { Logo } from '@/components/Logo';
import { PasswordInput } from '@/components/PasswordInput';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiRequest } from '@/lib/api-client';
import { applyServerErrors } from '@/lib/forms';
import { usePageTitle } from '@/lib/use-page-title';
import { useAuth, useCurrentUser } from './auth-context';

const formSchema = changePasswordSchema
  .and(z.object({ confirmPassword: z.string() }))
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });

type FormValues = z.infer<typeof formSchema>;

export function ChangePasswordPage() {
  usePageTitle('Change password');
  const { user } = useCurrentUser();
  const { setUser, logout } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const forced = user.mustChangePassword;

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(async ({ currentPassword, newPassword }) => {
    setFormError(null);
    try {
      const { data } = await apiRequest<{ data: UserDto }>('/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      setUser(data);
      toast.success('Password changed');
      void navigate('/', { replace: true });
    } catch (error) {
      setFormError(applyServerErrors(error, setError, ['currentPassword', 'newPassword']));
    }
  });

  return (
    <main className="bg-muted/40 flex min-h-svh flex-col items-center justify-center px-4 py-12">
      <Logo className="mb-8 text-lg" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Change password</CardTitle>
          <CardDescription>
            {forced
              ? 'Set a new password to finish signing in. Other devices will be signed out.'
              : 'Other devices will be signed out.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate className="grid gap-4">
            {formError ? (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}
            <FormField
              id="currentPassword"
              label={forced ? 'Temporary password' : 'Current password'}
              error={errors.currentPassword?.message}
            >
              <PasswordInput
                {...fieldA11y('currentPassword', errors.currentPassword?.message)}
                autoComplete="current-password"
                autoFocus
                {...register('currentPassword')}
              />
            </FormField>
            <FormField
              id="newPassword"
              label="New password"
              error={errors.newPassword?.message}
              hint="At least 10 characters."
            >
              <PasswordInput
                {...fieldA11y(
                  'newPassword',
                  errors.newPassword?.message,
                  'At least 10 characters.',
                )}
                autoComplete="new-password"
                {...register('newPassword')}
              />
            </FormField>
            <FormField
              id="confirmPassword"
              label="Confirm new password"
              error={errors.confirmPassword?.message}
            >
              <PasswordInput
                {...fieldA11y('confirmPassword', errors.confirmPassword?.message)}
                autoComplete="new-password"
                {...register('confirmPassword')}
              />
            </FormField>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="animate-spin" /> : null}
              Change password
            </Button>
            {forced ? (
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => void logout()}
              >
                Sign out
              </Button>
            ) : (
              <Button asChild variant="ghost" className="w-full">
                <Link to="/">Cancel</Link>
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
