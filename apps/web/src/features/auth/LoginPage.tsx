import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Loader2 } from 'lucide-react';
import { loginSchema, type LoginInput } from '@stockflow/shared';
import { FormField, fieldA11y } from '@/components/FormField';
import { Logo } from '@/components/Logo';
import { PasswordInput } from '@/components/PasswordInput';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { applyServerErrors } from '@/lib/forms';
import { usePageTitle } from '@/lib/use-page-title';
import { useAuth } from './auth-context';

export function LoginPage() {
  usePageTitle('Sign in');
  const { login, state } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login(values);
    } catch (error) {
      setFormError(applyServerErrors(error, setError, ['email', 'password']));
    }
  });

  const expired = state.status === 'anonymous' && state.reason === 'expired';

  return (
    <main className="bg-muted/40 flex min-h-svh flex-col items-center justify-center px-4 py-12">
      <Logo className="mb-8 text-lg" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Sign in</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate className="grid gap-4">
            {formError || expired ? (
              <Alert variant={formError ? 'destructive' : 'default'}>
                <AlertCircle />
                <AlertDescription>
                  {formError ?? 'Your session has expired. Sign in again to continue.'}
                </AlertDescription>
              </Alert>
            ) : null}
            <FormField id="email" label="Email" error={errors.email?.message}>
              <Input
                {...fieldA11y('email', errors.email?.message)}
                type="email"
                autoComplete="username"
                autoFocus
                {...register('email')}
              />
            </FormField>
            <FormField id="password" label="Password" error={errors.password?.message}>
              <PasswordInput
                {...fieldA11y('password', errors.password?.message)}
                autoComplete="current-password"
                {...register('password')}
              />
            </FormField>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="animate-spin" /> : null}
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
      <p className="text-muted-foreground mt-6 max-w-sm text-center text-xs">
        Accounts are created by your administrator.
      </p>
    </main>
  );
}
