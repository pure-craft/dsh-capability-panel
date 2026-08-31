import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      // Measure every source file, not only the ones some test happens to
      // import: an untested module must report 0%, never vanish from the table.
      all: true,
      include: ['src/**/*.ts'],
      exclude: [
        // Type-only declarations have no runtime to cover.
        'src/contract.ts',
        'src/host/types.ts',
        // The rendering half needs a browser-grade harness: React, Base UI,
        // and the host's primitives all resolve through the page's module
        // loader. It is covered instead by the composition test driving its
        // real route, and by the pure logic it delegates to — store.ts,
        // filter.ts, and disclosure.ts each gate at 100% on their own.
        'src/client/index.ts',
        'src/client/preset-section.ts',
      ],
      reporter: ['text', 'html'],
      // Thresholds are declared per glob rather than as one global bar with
      // `perFile`: the two cannot be combined — `perFile` applies the global
      // numbers to every file and a glob entry never overrides them. Grouping
      // this way keeps the same property (no file hides behind a well-covered
      // neighbour) while naming every gated file explicitly.
      thresholds: {
        // Every measured file gates at 100% on all four metrics. An uncovered
        // line or branch is either a missing test or dead code the gate is
        // correctly flagging for deletion — both are actionable, neither is
        // waived.
        'src/{loopback,wire,stats,load-state}.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'src/host/*.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'src/client/{store,preset-store,filter,disclosure,locale,styles}.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'src/index.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
