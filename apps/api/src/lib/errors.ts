import type { ApiErrorBody, ErrorCode } from '@stockflow/shared';

type ErrorDetails = NonNullable<ApiErrorBody['error']['details']>;

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: ErrorDetails,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const unauthenticated = (message = 'Authentication required') =>
  new AppError(401, 'UNAUTHENTICATED', message);

export const forbidden = (message = 'You do not have permission to perform this action') =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (entity = 'Resource') =>
  new AppError(404, 'NOT_FOUND', `${entity} not found`);

export const invalidState = (message: string) => new AppError(409, 'INVALID_STATE', message);

export const fieldError = (path: string, message: string) =>
  new AppError(400, 'VALIDATION_ERROR', message, [{ path, message }]);

export function isDuplicateKeyError(error: unknown): error is { code: 11000; keyPattern?: object } {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000
  );
}
