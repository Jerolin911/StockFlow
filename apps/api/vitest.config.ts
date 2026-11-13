import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@stockflow/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/setup.ts'],
    env: {
      NODE_ENV: 'test',
      JWT_ACCESS_SECRET: 'test-secret-that-is-at-least-32-characters-long',
      // Fixed test keys; tests that rotate keys pass their own keyring.
      DATA_ENCRYPTION_KEYS: `test1:${Buffer.alloc(32, 1).toString('base64')}`,
      BLIND_INDEX_KEY: Buffer.alloc(32, 2).toString('base64'),
      BCRYPT_ROUNDS: '4',
      LOGIN_RATE_LIMIT: '10',
    },
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
