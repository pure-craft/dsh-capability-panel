import { describe, expect, it } from 'vitest';
import { readSystemTools } from '../../src/host/catalog.js';

describe('system-tool catalog diagnostics', () => {
  it('reports a missing tools service when read independently', () => {
    const degraded: string[] = [];
    const services = { get: () => undefined };

    expect(readSystemTools(services as never, degraded, new Set())).toEqual([]);
    expect(degraded).toEqual(['tools service unavailable']);
  });

  it('does not duplicate a diagnostic already emitted by the MCP reader', () => {
    const degraded = ['tools service unavailable'];
    const services = { get: () => undefined };

    readSystemTools(services as never, degraded, new Set());
    expect(degraded).toEqual(['tools service unavailable']);
  });
});
