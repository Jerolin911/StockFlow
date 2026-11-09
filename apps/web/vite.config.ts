import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const apiTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@stockflow/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    // Containers on Windows and macOS don't see host file events; docker-compose.dev.yml sets this.
    watch:
      process.env.CHOKIDAR_USEPOLLING === 'true' ? { usePolling: true, interval: 300 } : undefined,
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    // Component tests opt into jsdom with a @vitest-environment docblock.
    environment: 'node',
    setupFiles: ['src/test/setup.ts'],
  },
});
