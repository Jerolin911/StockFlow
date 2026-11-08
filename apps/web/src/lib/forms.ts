import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from './api-client';

/**
 * Puts server-side field errors onto the matching form fields.
 * Returns a message for the form-level alert when the error isn't tied to a known field.
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): string | null {
  if (!(error instanceof ApiError)) return 'Something went wrong. Try again.';
  const unmatched = error.details.filter((detail) => {
    if (!fields.includes(detail.path as Path<T>)) return true;
    setError(detail.path as Path<T>, { type: 'server', message: detail.message });
    return false;
  });
  return error.details.length > 0 && unmatched.length === 0 ? null : error.message;
}
