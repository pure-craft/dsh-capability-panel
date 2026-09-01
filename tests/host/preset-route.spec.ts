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
    { states: new Map(), state: () => undefined, set: () => Promise.resolve() },
    { file: '/tmp/stats', read: () => ({ blocked: {}, records: [], warnings: [] }) } as never,
    {},
    { list, set, setServer, setSkill },
  );
  let status = 0;
  let text = '';
  const pendingRequest = request(method, '/api/agent-toolkit/presets', body, contentType);
  const pending = handler(pendingRequest.req, {
    writeHead(code: number) { status = code; },
    end(chunk?: string) { text = chunk ?? ''; },
  });
  pendingRequest.flush();
  await pending;
  return { status, text, list, set, setServer, setSkill };
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
