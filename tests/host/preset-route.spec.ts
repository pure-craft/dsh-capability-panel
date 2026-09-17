import { describe, expect, it, vi } from 'vitest';
import { createRouteHandler } from '../../src/host/route.js';

function request(method: string, url: string, body?: unknown, contentType = 'application/json') {
  const listeners = new Map<string, ((value?: unknown) => void)[]>();
  const req = {
    method,
    url,
    headers: { host: '127.0.0.1:3080', 'content-type': contentType },
    socket: { remoteAddress: '127.0.0.1' },
    on(event: string, listener: (value?: unknown) => void) {
      const bucket = listeners.get(event) ?? [];
      bucket.push(listener);
      listeners.set(event, bucket);
      return req;
    },
  };
  return { req, flush() {
    if (body !== undefined) for (const listener of listeners.get('data') ?? []) listener(JSON.stringify(body));
    for (const listener of listeners.get('end') ?? []) listener();
  } };
}

async function call(method: string, body?: unknown, contentType?: string) {
  const payload = { presets: [{ id: 'alpha', name: 'Alpha', trust: 'system' as const, skills: [], mcp: [], systemTools: [] }], writable: true };
  const list = vi.fn(() => Promise.resolve(payload));
  const set = vi.fn(() => Promise.resolve(payload));
  const setServer = vi.fn(() => Promise.resolve(payload));
  const setSkill = vi.fn(() => Promise.resolve(payload));
  const handler = createRouteHandler(
    { get: () => undefined } as never,
    { states: new Map(), state: () => undefined, set: () => Promise.resolve(), seed: () => Promise.resolve(), restore: () => Promise.resolve(), reseed: () => Promise.resolve() },
    { file: '/tmp/stats', read: () => ({ blocked: {}, records: [], warnings: [] }) } as never,
    {},
    { list, set, setServer, setSkill, defaultsFor: () => undefined },
    { overridesFor: () => undefined, record: () => Promise.resolve() },
  );
  let status = 0;
  let text = '';
  const pendingRequest = request(method, '/api/capability-panel/presets', body, contentType);
  const pending = handler(pendingRequest.req, {
    writeHead(code: number) { status = code; },
    end(chunk?: string) { text = chunk ?? ''; },
  });
  pendingRequest.flush();
  await pending;
  return { status, text, list, set, setServer, setSkill };
}

/** The same route harness, pointed at the reconnect endpoint. */
async function callReconnect(method: string, body?: unknown, ctx: unknown = { get: () => undefined }, contentType?: string) {
  const payload = { presets: [], writable: true };
  const list = vi.fn(() => Promise.resolve(payload));
  const handler = createRouteHandler(
    ctx as never,
    { states: new Map(), state: () => undefined, set: () => Promise.resolve(), seed: () => Promise.resolve(), restore: () => Promise.resolve(), reseed: () => Promise.resolve() },
    { file: '/tmp/stats', read: () => ({ blocked: {}, records: [], warnings: [] }) } as never,
    {},
    { list, set: vi.fn(), setServer: vi.fn(), setSkill: vi.fn(), defaultsFor: () => undefined },
    { overridesFor: () => undefined, record: () => Promise.resolve() },
  );
  let status = 0;
  let text = '';
  const pendingRequest = request(method, '/api/capability-panel/reconnect', body, contentType);
  const pending = handler(pendingRequest.req, {
    writeHead(code: number) { status = code; },
    end(chunk?: string) { text = chunk ?? ''; },
  });
  pendingRequest.flush();
  await pending;
  return { status, text, list };
}

describe('preset route', () => {
  it('lists presets over GET', async () => {
    const result = await call('GET');
    expect(result.status).toBe(200);
    expect(JSON.parse(result.text)).toEqual({
      presets: [{ id: 'alpha', name: 'Alpha', trust: 'system', skills: [], mcp: [], systemTools: [] }],
      writable: true,
    });
    expect(result.list).toHaveBeenCalledOnce();
  });

  it('persists a validated toggle over POST', async () => {
    const body = { presetId: 'alpha', name: 'bash', enabled: false };
    const result = await call('POST', body);
    expect(result.status).toBe(200);
    expect(result.set).toHaveBeenCalledWith('alpha', 'bash', false);
    expect(JSON.parse(result.text)).toMatchObject({ writable: true });
  });

  it('routes an explicit mcp-server toggle to the batch write', async () => {
    const body = { presetId: 'alpha', kind: 'mcp-server', name: 'search', enabled: false };
    const result = await call('POST', body);
    expect(result.status).toBe(200);
    expect(result.setServer).toHaveBeenCalledWith('alpha', 'search', false);
    expect(result.set).not.toHaveBeenCalled();
  });

  it('routes an explicit tool toggle like an omitted kind', async () => {
    const result = await call('POST', { presetId: 'alpha', kind: 'tool', name: 'bash', enabled: true });
    expect(result.status).toBe(200);
    expect(result.set).toHaveBeenCalledWith('alpha', 'bash', true);
  });

  it('routes an explicit skill toggle to the skill write', async () => {
    const body = { presetId: 'alpha', kind: 'skill', name: 'lark-mail', enabled: false };
    const result = await call('POST', body);
    expect(result.status).toBe(200);
    expect(result.setSkill).toHaveBeenCalledWith('alpha', 'lark-mail', false);
    expect(result.set).not.toHaveBeenCalled();
    expect(result.setServer).not.toHaveBeenCalled();
  });

  it('returns 405 and 415 before reading bodies', async () => {
    await expect(call('DELETE')).resolves.toMatchObject({ status: 405, text: 'method not allowed' });
    await expect(call('POST', {}, 'text/plain')).resolves.toMatchObject({ status: 415, text: 'expected application/json' });
  });

  it.each([
    [null, 'invalid request body'],
    [{ name: 'bash', enabled: false }, 'presetId is required'],
    [{ presetId: 'alpha', enabled: false }, 'name is required'],
    [{ presetId: 'alpha', name: 'bash', enabled: 'no' }, 'enabled must be boolean'],
    [{ presetId: 'alpha', kind: 'server', name: 'bash', enabled: false }, 'kind must be "tool", "mcp-server" or "skill"'],
  ])('validates POST body %#', async (body, message) => {
    const result = await call('POST', body);
    expect(result.status).toBe(400);
    expect(JSON.parse(result.text)).toEqual({ error: message });
  });
});

describe('reconnect route', () => {
  /** A host declaring one on-demand server, with its tools registered. */
  const hostCtx = {
    get: (name: string) => name === 'loader'
      ? { entries: () => [{ options: { id: 'mcp-client-ida', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'ida' } }, _dispose: () => Promise.resolve(), refresh: () => Promise.resolve() }] }
      : name === 'tools'
        ? { schemas: () => [{ name: 'mcp__ida__list' }, { name: 'mcp__ida__call' }, { name: 'bash' }] }
        : undefined,
  };

  it('restarts the declared server and answers with the refreshed list', async () => {
    const result = await callReconnect('POST', { server: 'ida' }, hostCtx);
    expect(result.status).toBe(200);
    expect(JSON.parse(result.text)).toEqual({ presets: [], writable: true, server: 'ida', tools: 2 });
    expect(result.list).toHaveBeenCalledOnce();
  });

  it('answers 404 for a server the host does not declare', async () => {
    const result = await callReconnect('POST', { server: 'ghost' }, hostCtx);
    expect(result.status).toBe(404);
    expect(JSON.parse(result.text)).toEqual({ error: 'MCP server "ghost" is not configured on this host' });
    expect(result.list).not.toHaveBeenCalled();
  });

  it('validates method, content type and body', async () => {
    await expect(callReconnect('GET')).resolves.toMatchObject({ status: 405, text: 'method not allowed' });
    await expect(callReconnect('POST', { server: 'ida' }, undefined, 'text/plain')).resolves.toMatchObject({ status: 415, text: 'expected application/json' });
    await expect(callReconnect('POST', null)).resolves.toMatchObject({ status: 400, text: JSON.stringify({ error: 'invalid request body' }) });
    await expect(callReconnect('POST', {})).resolves.toMatchObject({ status: 400, text: JSON.stringify({ error: 'server is required' }) });
    await expect(callReconnect('POST', { server: '' })).resolves.toMatchObject({ status: 400, text: JSON.stringify({ error: 'server is required' }) });
  });
});
