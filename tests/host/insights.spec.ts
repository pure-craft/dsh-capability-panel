import { describe, expect, it, vi } from 'vitest';
import { createInsightsController } from '../../src/host/insights.js';
import { initInsights, INSIGHTS_KEY } from '../../src/host/insights-fold.js';
import type { InsightsEvent } from '../../src/host/insights-fold.js';
const query = { scope: 'global' as const };
function fixture(count = 2) {
  const header = { id: 'one', cwd: '/work', agentPreset: 'base' };
  const events: InsightsEvent[] = Array.from({ length: count }, (_, seq) => ({ type: 'tool/call', seq, time: seq, data: { name: 'read', callId: `c${seq}` } }));
  const close = vi.fn(async () => {});
  const read = vi.fn((offset: number, length: number) => Promise.resolve({ events: events.slice(offset, offset + length) }));
  const services: Record<string, unknown> = {
    sessionQuery: { listSessions: vi.fn(() => Promise.resolve([{ header }])) },
    sessionPersistence: { stat: vi.fn(() => Promise.resolve({ revision: 'r' })), open: vi.fn(() => Promise.resolve({ header, inheritedEventCount: 0, read, close })) },
  };
  return { header, events, read, close, services, ctx: { get: (key: string) => services[key] } };
}
describe('insights controller', () => {
  it('contains cache, listing, registration and backend failures', async () => {
    const f = fixture();
    f.services['sessionProjectionCache'] = { cachedSnapshot: () => ({ values: { [INSIGHTS_KEY]: initInsights(f.header, 0) } }) };
    const controller = createInsightsController(f.ctx);
    expect((await controller.read(query)).coverage.indexedSessions).toBe(1);
    f.services['sessionProjectionCache'] = { cachedSnapshot: () => { throw new Error('broken cache'); } };
    expect((await controller.read(query)).warnings[0]).toContain('broken cache');
    expect((await controller.backfill(query)).warnings[0]).toContain('broken cache');
    f.services['sessionProjectionCache'] = undefined;
    f.services['sessionProjections'] = { register: () => { throw new Error('mounting'); } };
    createInsightsController(f.ctx);
    f.services['sessionProjections'] = undefined;
    f.read.mockImplementation(() => Promise.resolve({ events: Array.from({ length: 101 }, (_, seq) => ({ type: 'ignored', seq, time: 0, data: {} })) }));
    expect((await controller.backfill(query)).warnings[0]).toContain('exceeded');
  });
  it('merges sessions, survives changed revisions and honors cancellation', async () => {
    const f = fixture();
    f.services['sessionQuery'] = { listSessions: () => Promise.resolve([{ header: f.header }, { header: { ...f.header, id: 'two' } }]) };
    const state = initInsights(f.header, 0);
    state.tools = { read: { count: 2, lastUsed: 5 }, other: { count: 1, lastUsed: null } };
    state.skills = { skill: { count: 1, lastUsed: 6 } };
    f.services['sessionProjections'] = { register: () => () => {}, stateOf: () => state };
    f.services['agents'] = { get: () => ({ session: { header: f.header, seq: 0 } }) };
    const controller = createInsightsController(f.ctx);
    expect((await controller.read(query)).tools.find(row => row.name === 'read')?.count).toBe(4);
    expect((await controller.read(query)).presets[0]?.sessions).toBe(2);
    f.services['agents'] = undefined;
    const aborted = new AbortController(); aborted.abort();
    expect((await controller.backfill(query, aborted.signal)).remainingSessions).toBe(2);
    await controller.backfill(query);
    f.services['sessionPersistence'] = { stat: () => Promise.resolve({ revision: 'new' }), open: () => Promise.reject(new Error('unavailable')) };
    expect((await controller.read(query)).coverage.complete).toBe(false);
    expect((await controller.backfill(query)).warnings[0]).toContain('unavailable');
  });
  it('bounds session visits and discards changing or missing sources', async () => {
    const f = fixture(0);
    f.services['sessionQuery'] = { listSessions: () => Promise.resolve(Array.from({ length: 22 }, (_, i) => ({ header: { ...f.header, id: String(i) } }))) };
    const controller = createInsightsController(f.ctx);
    expect((await controller.backfill(query)).remainingSessions).toBe(2);
    f.services['sessionQuery'] = { listSessions: () => Promise.resolve([{ header: f.header }]) };
    let revision = 0;
    f.services['sessionPersistence'] = { stat: () => Promise.resolve({ revision: String(revision++) }), open: () => Promise.resolve({ header: f.header, inheritedEventCount: 0, read: f.read, close: f.close }) };
    expect((await controller.backfill(query)).processedSessions).toBe(0);
    f.services['sessionPersistence'] = { stat: () => Promise.resolve(undefined) };
    expect((await controller.backfill(query)).remainingSessions).toBe(1);
    f.services['sessionProjections'] = { register: () => () => {}, stateOf: () => undefined };
    f.services['agents'] = { get: () => ({ session: { header: f.header, seq: 0 } }) };
    expect((await controller.read(query)).coverage.unknown).toBe(true);
  });
  it('contains overlapping backfills and service replacement', async () => {
    const f = fixture(1);
    const unregister = vi.fn();
    f.services['sessionProjections'] = { register: () => unregister };
    const controller = createInsightsController(f.ctx);
    f.services['sessionProjections'] = undefined;
    controller.connect();
    expect(unregister).toHaveBeenCalledOnce();
    let release!: (value: { revision: string }) => void;
    let calls = 0;
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const stat = () => calls++ === 0 ? new Promise<{ revision: string }>(resolve => { release = resolve; entered(); }) : Promise.resolve({ revision: 'r' });
    f.services['sessionPersistence'] = { stat, open: () => Promise.resolve({ header: f.header, inheritedEventCount: 0, read: f.read, close: f.close }) };
    const first = controller.backfill(query);
    await ready;
    expect((await controller.backfill(query)).warnings[0]).toContain('active');
    const pending = first;
    release({ revision: 'r' });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    release({ revision: 'r' });
    await pending;
  });
  it('keeps listing log-free and marks missing history unknown', async () => {
    const f = fixture();
    const controller = createInsightsController(f.ctx);
    const result = await controller.read({ scope: 'workspace', sessionId: 'one' });
    expect(result.cwd).toBe('/work');
    expect(result.coverage).toEqual({ knownSessions: 1, indexedSessions: 0, complete: false, unknown: true });
    expect(f.read).not.toHaveBeenCalled();
    await controller.dispose();
  });
  it('backfills bounded pages, resumes and does not duplicate counts', async () => {
    const f = fixture(2100);
    const controller = createInsightsController(f.ctx);
    expect((await controller.backfill(query)).remainingSessions).toBe(1);
    expect(f.read).toHaveBeenCalledTimes(20);
    expect((await controller.read(query)).tools[0]?.count).toBe(2000);
    expect((await controller.backfill(query)).processedSessions).toBe(1);
    expect((await controller.read(query)).tools[0]?.count).toBe(2100);
    expect((await controller.read(query)).coverage.complete).toBe(true);
    const calls = f.read.mock.calls.length;
    expect((await controller.backfill(query)).processedSessions).toBe(0);
    expect(f.read).toHaveBeenCalledTimes(calls);
    expect(f.close).toHaveBeenCalledTimes(2);
  });
  it('reads live projections and filters preset usage while retaining summaries', async () => {
    const f = fixture();
    const state = initInsights(f.header, 0);
    state.tools = { read: { count: 2, lastUsed: 9 } };
    const unregister = vi.fn();
    const register = vi.fn(() => unregister);
    f.services['sessionProjections'] = { register, stateOf: () => state };
    f.services['agents'] = { get: () => ({ session: { header: f.header, seq: 2 } }) };
    const controller = createInsightsController(f.ctx);
    const result = await controller.read({ ...query, presetId: 'other' });
    expect(result.tools).toEqual([]);
    expect(result.presets[0]?.toolCalls).toBe(2);
    expect(result.coverage.complete).toBe(true);
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ key: INSIGHTS_KEY }));
    controller.connect();
    expect(register).toHaveBeenCalledTimes(1);
    await controller.dispose();
    expect(unregister).toHaveBeenCalledOnce();
  });
  it('rejects gaps and revision changes without publishing complete history', async () => {
    const f = fixture();
    f.events[1] = { ...f.events[1]!, seq: 8 };
    const controller = createInsightsController(f.ctx);
    expect((await controller.backfill(query)).warnings[0]).toContain('History changed');
    expect((await controller.read(query)).coverage.complete).toBe(false);
    expect(f.close).toHaveBeenCalledOnce();
  });
  it('degrades absent services, invalid workspace and disposed backfill', async () => {
    const controller = createInsightsController({ get: () => undefined });
    expect((await controller.read(query)).coverage.unknown).toBe(true);
    expect((await controller.backfill(query)).warnings[0]).toContain('unavailable');
    await controller.dispose();
    expect((await controller.backfill(query)).warnings).not.toEqual([]);
    const f = fixture();
    expect((await createInsightsController(f.ctx).read({ scope: 'workspace' })).warnings[0]).toContain('unknown');
  });
  it('persists only complete metadata and treats reopened metadata as lower bound', async () => {
    const f = fixture();
    const values = new Map<string, unknown>();
    const put = vi.fn((id: string, value: unknown) => { values.set(id, value); return Promise.resolve(); });
    const domainClose = vi.fn(async () => {});
    f.services['storageDomain'] = { open: vi.fn(() => Promise.resolve({ table: () => ({ get: (id: string) => values.get(id), put }), close: domainClose })) };
    const first = createInsightsController(f.ctx);
    await first.backfill(query);
    expect(put).toHaveBeenCalledOnce();
    await first.dispose();
    const second = createInsightsController(f.ctx);
    const result = await second.read(query);
    expect(result.tools[0]?.count).toBe(2);
    expect(result.coverage.complete).toBe(false);
    await second.dispose();
    expect(domainClose).toHaveBeenCalledTimes(2);
  });
});
