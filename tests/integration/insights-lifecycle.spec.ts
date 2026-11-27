import { describe, expect, it, vi } from 'vitest';
import { apply } from '../../src/index.js';

const controller = vi.hoisted(() => ({ connect: vi.fn(), dispose: vi.fn(() => Promise.reject(new Error('disposed'))), read: vi.fn(), backfill: vi.fn() }));
vi.mock('../../src/host/insights.js', () => ({ createInsightsController: () => controller }));
describe('insights composition lifecycle', () => {
  it('connects only after projections arrive and contains a disposal rejection', async () => {
    const cleanups: (() => void)[] = [];
    const routeDispose = vi.fn();
    let projectionsReady: (() => void) | undefined;
    apply({
      webServer: { register: () => routeDispose }, get: () => undefined, on: () => {},
      effect(factory: () => (() => void) | void) { const cleanup = factory(); if (cleanup) cleanups.push(cleanup); },
      inject(services: string[], callback: () => void) {
        expect(services).toEqual(['sessionProjections']);
        projectionsReady = callback;
      },
    });
    expect(controller.connect).not.toHaveBeenCalled();
    expect(projectionsReady).toBeTypeOf('function');
    projectionsReady!();
    expect(controller.connect).toHaveBeenCalledOnce();
    cleanups.forEach(cleanup => { cleanup(); });
    await Promise.resolve();
    expect(controller.dispose).toHaveBeenCalledOnce();
    expect(routeDispose).toHaveBeenCalledOnce();
  });
});
