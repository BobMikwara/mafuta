import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolvePath = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@fueltrack/core': resolvePath('./packages/core/src/index.ts'),
      '@fueltrack/api': resolvePath('./packages/api/src/index.ts'),
    },
  },
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'apps/*/test/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
      'scripts/**/*.test.ts',
      'prisma/**/*.test.ts',
    ],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
      exclude: [
        '**/index.ts',
        '**/*.test.ts',
        '**/dist/**',
        // Modules that contain only type declarations have nothing to execute.
        '**/domain/reading.ts',
        '**/domain/site.ts',
        '**/ports/tank-gauge-adapter.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
