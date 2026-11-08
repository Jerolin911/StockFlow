import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiErrorBody } from '@stockflow/shared';
import { ZodError } from 'zod';
import { AppError, isDuplicateKeyError } from '../lib/errors.js';

function send(res: Parameters<RequestHandler>[1], status: number, error: ApiErrorBody['error']) {
  res.status(status).json({ error } satisfies ApiErrorBody);
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  send(res, 404, { code: 'NOT_FOUND', message: 'Route not found' });
};

export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err instanceof AppError) {
    return send(res, err.status, {
      code: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  if (err instanceof ZodError) {
    return send(res, 400, {
      code: 'VALIDATION_ERROR',
      message: 'Some fields are invalid',
      details: err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
  }

  const bodyParserType = (err as { type?: string } | null)?.type;
  if (bodyParserType === 'entity.parse.failed') {
    return send(res, 400, { code: 'INVALID_JSON', message: 'Request body is not valid JSON' });
  }
  if (bodyParserType === 'entity.too.large') {
    return send(res, 413, { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' });
  }

  if (isDuplicateKeyError(err)) {
    const field = Object.keys(err.keyPattern ?? {})[0] ?? 'value';
    return send(res, 409, {
      code: 'CONFLICT',
      message: `A record with this ${field} already exists`,
      details: [{ path: field, message: `This ${field} is already in use` }],
    });
  }

  req.log.error({ err }, 'Unhandled error');
  return send(res, 500, { code: 'INTERNAL_ERROR', message: 'Something went wrong' });
};
