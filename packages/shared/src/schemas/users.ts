import { z } from 'zod';
import { ROLES } from '../roles.js';
import { emailSchema, passwordSchema } from './auth.js';
import { paginationQuerySchema } from './common.js';

const nameSchema = z.string().trim().min(1, 'Enter a name').max(100);
const roleSchema = z.enum(ROLES, 'Select a role');

export const createUserSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  role: roleSchema,
  password: passwordSchema,
});

export const updateUserSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    role: roleSchema,
    isActive: z.boolean(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, 'No changes provided');

export const resetPasswordSchema = z.object({
  password: passwordSchema,
});

export const USER_SORT_FIELDS = ['name', 'email', 'role', 'createdAt', 'lastLoginAt'] as const;

export const listUsersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  role: roleSchema.optional(),
  status: z.enum(['active', 'inactive']).optional(),
  sort: z
    .string()
    .regex(new RegExp(`^-?(${USER_SORT_FIELDS.join('|')})$`))
    .default('name'),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
