import { objectIdSchema } from '@stockflow/shared';
import { notFound } from './errors.js';

export function parseId(value: unknown, entity: string): string {
  const result = objectIdSchema.safeParse(value);
  if (!result.success) throw notFound(entity);
  return result.data;
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseSort(sort: string): Record<string, 1 | -1> {
  return sort.startsWith('-') ? { [sort.slice(1)]: -1 } : { [sort]: 1 };
}
