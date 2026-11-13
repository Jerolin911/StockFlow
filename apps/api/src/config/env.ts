import { existsSync } from 'node:fs';
import { z } from 'zod';
import { parseKey, parseKeyring, type Keyring } from '../lib/keyring.js';

if (process.env.NODE_ENV !== 'test' && existsSync('.env')) process.loadEnvFile('.env');

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

/** Parses with `parse`, turning its error into a validation issue on the variable. */
const decoded = <T>(name: string, parse: (value: string) => T) =>
  z.string(`${name} is required (see .env.example)`).transform((value, ctx): T => {
    try {
      return parse(value);
    } catch (error) {
      ctx.addIssue({ code: 'custom', message: (error as Error).message });
      return z.NEVER;
    }
  });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  DATA_ENCRYPTION_KEYS: decoded<Keyring>('DATA_ENCRYPTION_KEYS', parseKeyring),
  BLIND_INDEX_KEY: decoded('BLIND_INDEX_KEY', (value) => parseKey(value, 'BLIND_INDEX_KEY')),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  COOKIE_SECURE: booleanString.optional(),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  TRUST_PROXY: z.string().default('loopback'),
  LOGIN_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  API_DOCS: booleanString.default(true),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  BOOTSTRAP_ADMIN_NAME: z.string().trim().min(1).default('Administrator'),
  BOOTSTRAP_ADMIN_EMAIL: z.string().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().optional(),
});

function loadEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = result.data;
  return {
    ...env,
    isProduction: env.NODE_ENV === 'production',
    cookieSecure: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
    logLevel: env.LOG_LEVEL ?? (env.NODE_ENV === 'test' ? 'silent' : 'info'),
  };
}

export const env = loadEnv();
