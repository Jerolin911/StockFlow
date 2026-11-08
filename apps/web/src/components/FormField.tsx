import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';

export function fieldA11y(id: string, error: string | undefined, hint?: string) {
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean);
  return {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy.length > 0 ? describedBy.join(' ') : undefined,
  };
}

interface FormFieldProps {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}

export function FormField({ id, label, error, hint, action, children }: FormFieldProps) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        {action}
      </div>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
