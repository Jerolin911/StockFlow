import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { ROLE_LABELS, ROLES, createUserSchema, type Role, type UserDto } from '@stockflow/shared';
import { FormField, fieldA11y } from '@/components/FormField';
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
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { applyServerErrors } from '@/lib/forms';
import { useCreateUser, useUpdateUser } from './api';
import { TemporaryPasswordField } from './TemporaryPasswordField';

// Editing doesn't change the password, so the field is accepted but not validated.
const editSchema = createUserSchema.extend({ password: z.string() });

type FormValues = z.input<typeof createUserSchema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the dialog edits this user; otherwise it creates a new one. */
  user: UserDto | null;
  currentUserId: string;
}

export function UserFormDialog({ open, onOpenChange, user, currentUserId }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Content unmounts while closed, so each opening starts with a fresh form. */}
        <UserForm user={user} currentUserId={currentUserId} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function UserForm({
  user,
  currentUserId,
  onDone,
}: {
  user: UserDto | null;
  currentUserId: string;
  onDone: () => void;
}) {
  const editing = user !== null;
  const isSelf = user?.id === currentUserId;
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(editing ? editSchema : createUserSchema),
    defaultValues: user
      ? { name: user.name, email: user.email, role: user.role, password: '' }
      : { name: '', email: '', role: 'staff', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (user) {
        await updateUser.mutateAsync({
          id: user.id,
          name: values.name,
          email: values.email,
          ...(isSelf ? {} : { role: values.role as Role }),
        });
        toast.success('Changes saved');
      } else {
        await createUser.mutateAsync(createUserSchema.parse(values));
        toast.success(`${values.name.trim()} added`);
      }
      onDone();
    } catch (error) {
      setFormError(applyServerErrors(error, setError, ['name', 'email', 'role', 'password']));
    }
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? 'Edit user' : 'Add user'}</DialogTitle>
        <DialogDescription>
          {editing
            ? 'Update account details and role.'
            : 'Create an account and set a temporary password.'}
        </DialogDescription>
      </DialogHeader>
      <form id="user-form" onSubmit={onSubmit} noValidate className="grid gap-4">
        {formError ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}
        <FormField id="user-name" label="Full name" error={errors.name?.message}>
          <Input
            {...fieldA11y('user-name', errors.name?.message)}
            autoComplete="off"
            {...register('name')}
          />
        </FormField>
        <FormField id="user-email" label="Email" error={errors.email?.message}>
          <Input
            {...fieldA11y('user-email', errors.email?.message)}
            type="email"
            autoComplete="off"
            {...register('email')}
          />
        </FormField>
        <FormField
          id="user-role"
          label="Role"
          error={errors.role?.message}
          {...(isSelf ? { hint: "You can't change your own role." } : {})}
        >
          <Controller
            control={control}
            name="role"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange} disabled={isSelf}>
                <SelectTrigger
                  {...fieldA11y('user-role', errors.role?.message)}
                  className="w-full"
                  onBlur={field.onBlur}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((role) => (
                    <SelectItem key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </FormField>
        {editing ? null : (
          <TemporaryPasswordField
            id="user-password"
            label="Temporary password"
            error={errors.password?.message}
            registration={register('password')}
            onGenerate={(password) => setValue('password', password, { shouldValidate: true })}
          />
        )}
      </form>
      <DialogFooter>
        <Button variant="outline" onClick={onDone} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" form="user-form" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="animate-spin" /> : null}
          {editing ? 'Save changes' : 'Add user'}
        </Button>
      </DialogFooter>
    </>
  );
}
