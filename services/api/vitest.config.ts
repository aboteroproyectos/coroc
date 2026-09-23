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
    // Cobertura mínima de la API (§21, COVERAGE=1 en CI). Fuera: el arranque y las herramientas de línea de comandos.
    coverage: {
      enabled: process.env.COVERAGE === '1',
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/main.ts', 'src/cli/**', 'src/db/migrate.ts'],
      reporter: ['text-summary', 'lcov'],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 65 },
    },
  },
});
