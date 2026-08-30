import { defineConfig } from 'vitest/config';

/* ================================================================
   VITEST — two projects, one coverage report, two different bars.

   `packages` is the certification-grade half: pure TypeScript, 80% gate,
   nothing in it may import the DOM. That configuration is unchanged from M1.2
   and must stay unchanged — the gate is what makes the engine trustworthy.

   `client` (M1.5 run 5) brings `apps/client` under test for the first time.
   It runs in `jsdom` because the modules under test sit one import away from
   `document.querySelector`, and it is deliberately NOT behind the 80%
   threshold yet: most of `apps/client` is the Canvas 2D renderer that M1.8
   replaces wholesale, so a gate over the whole app would be a gate over code
   that is scheduled for deletion. The seams that survive M1.8 —
   entry-window, gateway, the engine adapter, round, InterpBuffer, constants —
   are the ones tested here, and its coverage is reported so the gate can be
   set deliberately rather than inherited.
================================================================ */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'packages',
          include: ['packages/*/test/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'client',
          include: ['apps/client/test/**/*.test.js'],
          environment: 'jsdom',
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: 'coverage',
      include: ['packages/*/src/**/*.ts', 'apps/client/src/**/*.js'],
      // Placeholder barrels carrying only a package-name constant. Each is
      // removed from this list by the milestone that fills the package in:
      // engine M1.3 (done), feed M1.6, gateway M2.2, sim M1.7.
      exclude: [
        'packages/feed/src/index.ts',
        'packages/gateway/src/index.ts',
        'packages/sim/src/index.ts',
      ],
      // CLAUDE.md / testing rule: 80% minimum — over `packages/*` ONLY.
      // `apps/client` is measured but ungated; see the `client` project note.
      thresholds: {
        'packages/**': {
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
      },
    },
  },
});
