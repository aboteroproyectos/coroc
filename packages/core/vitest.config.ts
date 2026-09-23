import { defineConfig } from 'vitest/config';

// Núcleo financiero, cumplimiento y extracción (§21): cobertura mínima del 90 % (COVERAGE=1 en CI).
export default defineConfig({
  test: {
    coverage: {
      enabled: process.env.COVERAGE === '1',
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text-summary', 'lcov'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 80 },
    },
  },
});
