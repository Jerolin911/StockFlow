import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { resetPasswordSchema, type ResetPasswordInput, type UserDto } from '@stockflow/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { applyServerErrors } from '@/lib/forms';
import { useResetPassword } from './api';
import { TemporaryPasswordField } from './TemporaryPasswordField';

interface Props {
  user: UserDto | null;
  onOpenChange: (open: boolean) => void;
}

export function ResetPasswordDialog({ user, onOpenChange }: Props) {
  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {user ? <ResetPasswordForm user={user} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordForm({ user, onDone }: { user: UserDto; onDone: () => void }) {
  const resetPassword = useResetPassword();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await resetPassword.mutateAsync({ id: user.id, ...values });
      toast.success(`Password reset for ${user.name}`);
      onDone();
    } catch (error) {
      setFormError(applyServerErrors(error, setError, ['password']));
    }
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Reset password</DialogTitle>
        <DialogDescription>
          {user.name} will be signed out everywhere and must set a new password at next sign-in.
        </DialogDescription>
      </DialogHeader>
      <form id="reset-password-form" onSubmit={onSubmit} noValidate className="grid gap-4">
        {formError ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}
        <TemporaryPasswordField
          id="reset-password"
          label="Temporary password"
          error={errors.password?.message}
          registration={register('password')}
          onGenerate={(password) => setValue('password', password, { shouldValidate: true })}
        />
      </form>
      <DialogFooter>
        <Button variant="outline" onClick={onDone} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" form="reset-password-form" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="animate-spin" /> : null}
          Reset password
        </Button>
      </DialogFooter>
    </>
  );
}
