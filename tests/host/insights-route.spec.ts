import { describe, expect, it, vi } from 'vitest';
import { createRouteHandler } from '../../src/host/route.js';

async function call(path: string, method = 'GET', body?: unknown, available = true, contentType = 'application/json') {
  const listeners = new Map<string, (value?: unknown) => void>();
  const read = vi.fn(() => Promise.resolve({ coverage: {} }));
  const backfill = vi.fn(() => Promise.resolve({ processedSessions: 1, remainingSessions: 0, warnings: [] }));
  let settings = {
    presets: { alpha: ['bash'] },
    presetSkills: { alpha: ['writing'] },
    sessions: { s1: { skills: { writing: false }, mcpServers: {}, mcpTools: {}, systemTools: {} } },
    ...(body === 'unset' ? {} : { insightsEntry: true }),
  };
  const replace = vi.fn((next: object) => { settings = next as typeof settings; return Promise.resolve(); });
  const handler = createRouteHandler({ get: () => undefined } as never, {} as never, {} as never, {}, {} as never, {} as never,
    available ? { read, backfill } as never : undefined,
    available ? { scope: () => ({ get: () => settings, replace }), serialize: async work => work() } : undefined);
  let status = 0;
  let text = '';
  const pending = handler({ method, url: `/api/capability-panel/insights${path}`, headers: { host: '127.0.0.1', 'content-type': contentType }, socket: { remoteAddress: '127.0.0.1' }, on(event: string, fn: (value?: unknown) => void) { listeners.set(event, fn); } },
    { writeHead(code: number) { status = code; }, end(value?: string) { text = value ?? ''; } });
  listeners.get('data')?.(JSON.stringify(body ?? {})); listeners.get('end')?.();
  await pending;
  return { status, text, read, backfill, replace, settings };
}
describe('insights routes', () => {
  it('passes bounded scope selectors to read and backfill', async () => {
    const get = await call('?session=s&scope=global&preset=dev');
    expect((await call('')).status).toBe(200);
    expect(get.status).toBe(200);
    expect(get.read).toHaveBeenCalledWith({ sessionId: 's', scope: 'global', presetId: 'dev' });
    const post = await call('/backfill?session=s', 'POST');
    expect(post.backfill).toHaveBeenCalledWith({ sessionId: 's', scope: 'workspace' });
  });
  it('persists only visibility with all other settings preserved', async () => {
    expect(JSON.parse((await call('/preferences')).text)).toEqual({ insightsEntry: true });
    expect(JSON.parse((await call('/preferences', 'GET', 'unset')).text)).toEqual({ insightsEntry: true });
    const result = await call('/preferences', 'POST', { insightsEntry: false });
    expect(result.status).toBe(200);
    expect(result.settings).toEqual({
      presets: { alpha: ['bash'] },
      presetSkills: { alpha: ['writing'] },
      sessions: { s1: { skills: { writing: false }, mcpServers: {}, mcpTools: {}, systemTools: {} } },
      insightsEntry: false,
    });
    expect(JSON.parse(result.text)).toEqual({ insightsEntry: false });
  });
  it.each([
    ['', 'POST', undefined, true, 'application/json', 405],
    ['/backfill', 'GET', undefined, true, 'application/json', 405],
    ['/backfill', 'POST', {}, true, 'text/plain', 415],
    ['?scope=invalid', 'GET', undefined, true, 'application/json', 400],
    ['', 'GET', undefined, false, 'application/json', 503],
    ['/preferences', 'GET', undefined, false, 'application/json', 503],
    ['/preferences', 'DELETE', undefined, true, 'application/json', 405],
    ['/preferences', 'POST', {}, true, 'application/json', 400],
    ['/preferences', 'POST', {}, true, 'text/plain', 415],
  ] as const)('rejects invalid request %#', async (path, method, body, available, type, status) => {
    expect((await call(path, method, body, available, type)).status).toBe(status);
  });
});
