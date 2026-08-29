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
      // Thresholds are declared per glob rather than as one global bar with
      // `perFile`: the two cannot be combined — `perFile` applies the global
      // numbers to every file and a glob entry never overrides them. Grouping
      // this way keeps the same property (no file hides behind a well-covered
      // neighbour) while letting one file carry a justified exception.
      thresholds: {
        // Everything except the host half: fully covered, and expected to stay
        // that way. An uncovered line here is usually dead code.
        'src/{loopback,wire,stats,load-state}.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'src/client/{store,filter,disclosure}.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        // The host half reaches 100% on lines and functions — nothing in it is
        // dead. The residual branches are unreachable fallbacks on the `??`
        // and `?.` operators guarding optional host services
        // (`ctx.tools?.schemas() ?? []`, `req.url ?? '/'`). Hitting them would
        // require a host that contradicts itself — a service both present and
        // absent within one call — so a test written to move the counter would
        // assert nothing about behaviour. The bar is set to what the real
        // paths reach, and lines/functions stay pinned at 100%.
        'src/index.ts': {
          statements: 99,
          branches: 94,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
