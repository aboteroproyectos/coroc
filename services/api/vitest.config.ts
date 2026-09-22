import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC conserva los metadatos de decoradores que NestJS necesita para la inyección de dependencias.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 60000,
    hookTimeout: 120000,
    fileParallelism: false,
    pool: 'forks',
  },
});
