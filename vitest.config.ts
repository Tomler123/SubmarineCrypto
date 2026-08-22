import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Packages only. apps/client is the Canvas 2D prototype that M1.8 replaces
    // with a PixiJS scene; its logic moves into packages/* as M1.3–M1.6 land,
    // and the tests move with it.
    include: ['packages/*/test/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: 'coverage',
      include: ['packages/*/src/**/*.ts'],
      // Placeholder barrels carrying only a package-name constant. Each is
      // removed from this list by the milestone that fills the package in:
      // engine M1.3, feed M1.6, gateway M2.2, sim M1.7.
      exclude: [
        'packages/engine/src/index.ts',
        'packages/feed/src/index.ts',
        'packages/gateway/src/index.ts',
        'packages/sim/src/index.ts',
      ],
      // CLAUDE.md / testing rule: 80% minimum.
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
