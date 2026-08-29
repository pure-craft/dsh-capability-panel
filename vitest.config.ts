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
        // The rendering half needs a browser-grade harness: React, Base UI,
        // and the host's primitives all resolve through the page's module
        // loader. It is covered instead by the composition test driving its
        // real route, and by the pure logic it delegates to — store.ts,
        // filter.ts, and disclosure.ts each gate at 100% on their own.
        'src/client/index.ts',
      ],
      reporter: ['text', 'html'],
      // Per-file, matching DSH's gate: a repo-wide average lets one entirely
      // untested file hide behind well-covered neighbours.
      thresholds: {
        perFile: true,
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
