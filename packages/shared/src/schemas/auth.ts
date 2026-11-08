import { z } from 'zod';

const encoder = new TextEncoder();

// bcrypt only uses the first 72 bytes of its input, so longer passwords would be silently truncated.
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .refine((value) => encoder.encode(value).length <= 72, 'Password is too long');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address').max(254));

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(200),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password').max(200),
    newPassword: passwordSchema,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    path: ['newPassword'],
    message: 'New password must be different from the current one',
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
