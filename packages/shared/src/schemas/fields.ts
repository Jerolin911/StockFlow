import { z } from 'zod';
import { MAX_MONEY } from '../money.js';

export const MAX_QUANTITY = 1_000_000_000;

export const requiredText = (label: string, max: number) =>
  z
    .string(`Enter ${label}`)
    .trim()
    .min(1, `Enter ${label}`)
    .max(max, `Use at most ${max} characters`);

// No defaults here: a default inside .partial() would overwrite stored values on PATCH.
// Create schemas add .default('') explicitly.
export const optionalText = (max: number) =>
  z.string().trim().max(max, `Use at most ${max} characters`);

export const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((v) => v === '' || z.email().safeParse(v).success, 'Enter a valid email address');

export const moneySchema = z
  .number('Enter an amount')
  .int('Amount must be in minor units')
  .min(0, 'Amount cannot be negative')
  .max(MAX_MONEY, 'Amount is too large');

export const basisPointsSchema = z.number().int().min(0).max(10_000, 'Rate cannot exceed 100%');

export const nonNegativeQuantity = z
  .number('Enter a quantity')
  .int('Use whole units')
  .min(0, 'Cannot be negative')
  .max(MAX_QUANTITY);

export const positiveQuantity = z
  .number('Enter a quantity')
  .int('Use whole units')
  .min(1, 'Must be at least 1')
  .max(MAX_QUANTITY);

export const codeSchema = (min: number, max: number) =>
  z
    .string('Enter a code')
    .trim()
    .toUpperCase()
    .regex(
      new RegExp(`^[A-Z0-9][A-Z0-9-]{${min - 1},${max - 1}}$`),
      `Use ${min}–${max} letters, numbers or dashes`,
    );

export const statusFilter = z.enum(['active', 'inactive']).optional();

export const sortParam = <T extends readonly string[]>(
  fields: T,
  fallback: T[number] | `-${T[number]}`,
) =>
  z
    .string()
    .regex(new RegExp(`^-?(${fields.join('|')})$`), 'Invalid sort field')
    .default(fallback);

export const dateParam = z.iso.date('Use YYYY-MM-DD').optional();
