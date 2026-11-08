import type { UseFormRegisterReturn } from 'react-hook-form';
import { FormField, fieldA11y } from '@/components/FormField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { generateTemporaryPassword } from './password';

const HINT = 'The user must change it at first sign-in. Share it with them securely.';

interface Props {
  id: string;
  label: string;
  error: string | undefined;
  registration: UseFormRegisterReturn;
  onGenerate: (password: string) => void;
}

export function TemporaryPasswordField({ id, label, error, registration, onGenerate }: Props) {
  return (
    <FormField
      id={id}
      label={label}
      error={error}
      hint={HINT}
      action={
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs"
          onClick={() => onGenerate(generateTemporaryPassword())}
        >
          Generate
        </Button>
      }
    >
      <Input
        {...fieldA11y(id, error, HINT)}
        autoComplete="off"
        spellCheck={false}
        className="font-mono"
        {...registration}
      />
    </FormField>
  );
}
