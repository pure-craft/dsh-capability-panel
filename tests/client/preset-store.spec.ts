import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  createSnapshotStore<T>(initial: T) {
    let state = initial;
    const listeners = new Set<() => void>();
    return {
      getSnapshot: () => state,
      subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
      set(next: T) { state = next; for (const listener of listeners) listener(); },
    };
  },
}));

function response(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response;
}

const payload = (id = 'standard') => ({
  writable: true,
  presets: [{
    id,
    name: id === 'standard' ? 'Standard' : id,
    description: 'Full agent',
    trust: 'system',
    mcp: [{
      server: 'search',
      enabled: true,
      tools: [{ name: 'mcp__search__web', label: 'web', description: 'lookup', enabled: true }],
    }],
    systemTools: [
      { name: 'bash', label: 'bash', description: 'shell', enabled: true },
      { name: 'run_code', label: 'run_code', enabled: true, reserved: true },
    ],
  }],
});

async function loadStore() {
  vi.resetModules();
  return import('../../src/client/preset-store.js');
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('preset tool store', () => {
  it('loads, validates and selects the first preset', async () => {
    const store = await loadStore();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response(payload()))));

    await store.loadPresetTools();

    expect(store.getPresetToolsSnapshot()).toMatchObject({ loading: false, selectedId: 'standard', error: null });
    expect(store.getPresetToolsSnapshot().payload?.presets[0]?.systemTools[1]).toMatchObject({ name: 'run_code', reserved: true });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response({
      writable: false,
      presets: [{ id: 'plain', name: 'Plain', trust: 'user', broken: 'bad yaml', mcp: [], systemTools: [] }],
    }))));
    await store.loadPresetTools();
    expect(store.getPresetToolsSnapshot().payload?.presets[0]).toEqual({ id: 'plain', name: 'Plain', trust: 'user', broken: 'bad yaml', mcp: [], systemTools: [] });
    const listener = vi.fn();
    const dispose = store.subscribePresetTools(listener);
    store.selectPreset('plain');
    expect(listener).toHaveBeenCalledOnce();
    dispose();
  });

  it('lets the user select only a known preset', async () => {
    const store = await loadStore();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response({
      writable: true,
      presets: [payload('standard').presets[0], { ...payload('minimal').presets[0], trust: 'user' }],
    }))));
    await store.loadPresetTools();

    store.selectPreset('minimal');
    expect(store.getPresetToolsSnapshot().selectedId).toBe('minimal');
    store.selectPreset('ghost');
    expect(store.getPresetToolsSnapshot().selectedId).toBe('minimal');
  });

  it('serializes writes and adopts each authoritative payload', async () => {
    const store = await loadStore();
    const calls: Array<() => void> = [];
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      calls.push(() => { resolve(response(payload(calls.length === 1 ? 'first' : 'second'))); });
    }));
    vi.stubGlobal('fetch', fetchMock);

    const first = store.setPresetTool('standard', 'bash', false);
    const second = store.setPresetTool('standard', 'bash', true);
    await vi.waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1); });
    calls[0]?.();
    await first;
    await vi.waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(2); });
    calls[1]?.();
    await second;

    expect(store.getPresetToolsSnapshot().payload?.presets[0]?.id).toBe('second');
  });

  it('sends the server toggle as one mcp-server write', async () => {
    const store = await loadStore();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      void init;
      return Promise.resolve(response(payload()));
    });
    vi.stubGlobal('fetch', fetchMock);

    await store.setPresetServer('standard', 'search', false);

    const body = fetchMock.mock.calls[0]?.[1]?.body;
    expect(typeof body).toBe('string');
    expect(JSON.parse(typeof body === 'string' ? body : '{}')).toEqual({
      presetId: 'standard', kind: 'mcp-server', name: 'search', enabled: false,
    });
  });

  it('keeps the last payload and surfaces JSON and non-JSON failures', async () => {
    const store = await loadStore();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response(payload()))));
    await store.loadPresetTools();

    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response({ error: 'read only' }, 503))));
    await store.setPresetTool('standard', 'bash', false);
    expect(store.getPresetToolsSnapshot().error).toBe('HTTP 503：read only');
    expect(store.getPresetToolsSnapshot().payload).not.toBeNull();

    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response({ error: 42 }, 500))));
    await store.loadPresetTools();
    expect(store.getPresetToolsSnapshot().error).toBe('HTTP 500');

    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 502, json: () => Promise.reject(new Error('html')) })));
    await store.loadPresetTools();
    expect(store.getPresetToolsSnapshot().error).toBe('HTTP 502');
  });

  it('rejects malformed host payloads rather than showing an empty list', async () => {
    const store = await loadStore();
    for (const body of [null, {}, { writable: 'yes', presets: [] }, { writable: true, presets: [null] }, {
      writable: true, presets: [{ id: 1, name: 'x', trust: 'system', mcp: [], systemTools: [] }],
    }, {
      writable: true, presets: [{ id: 'x', name: 'x', trust: 'other', mcp: [], systemTools: [] }],
    }, {
      writable: true, presets: [{ id: 'x', name: 'x', trust: 'system', description: 1, mcp: [], systemTools: [] }],
    }, {
      writable: true, presets: [{ id: 'x', name: 'x', trust: 'system', broken: 1, mcp: [], systemTools: [] }],
    }, {
      writable: true, presets: [{ id: 'x', name: 'x', trust: 'system', mcp: [], systemTools: [null] }],
    }, {
      writable: true, presets: [{ id: 'x', name: 'x', trust: 'system', mcp: [], systemTools: [{ name: 1, label: 'a', enabled: true }] }],
    }, {
      writable: true, presets: [{ id: 'x', name: 'x', trust: 'system', mcp: [], systemTools: [{ name: 'a', label: 'a', enabled: true, description: 1 }] }],
    }, {
      writable: true, presets: [{ id: 'x', name: 'x', trust: 'system', mcp: [], systemTools: [{ name: 'a', label: 'a', enabled: true, reserved: 'yes' }] }],
    }, {
      writable: true, presets: [{ id: 'x', name: 'x', trust: 'system', mcp: 'nope', systemTools: [] }],
    }, {
      writable: true, presets: [{ id: 'x', name: 'x', trust: 'system', mcp: [null], systemTools: [] }],
    }, {
      writable: true, presets: [{ id: 'x', name: 'x', trust: 'system', mcp: [{ server: 1, enabled: true, tools: [] }], systemTools: [] }],
    }, {
      writable: true, presets: [{ id: 'x', name: 'x', trust: 'system', mcp: [{ server: 's', enabled: 'yes', tools: [] }], systemTools: [] }],
    }, {
      writable: true, presets: [{ id: 'x', name: 'x', trust: 'system', mcp: [{ server: 's', enabled: true, tools: 'nope' }], systemTools: [] }],
    }, {
      writable: true, presets: [{ id: 'x', name: 'x', trust: 'system', mcp: [{ server: 's', enabled: true, tools: [{ name: 'a', enabled: true }] }], systemTools: [] }],
    }]) {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response(body))));
      await store.loadPresetTools();
      expect(store.getPresetToolsSnapshot().error).toMatch(/unexpected preset payload shape/);
    }
  });

  it('ignores dead answers after reset and stringifies non-Error failures', async () => {
    const store = await loadStore();
    let resolve!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((done) => { resolve = done; })));
    const pending = store.loadPresetTools();
    store.resetPresetTools();
    resolve(response(payload()));
    await pending;
    expect(store.getPresetToolsSnapshot()).toEqual({ loading: false, payload: null, selectedId: null, error: null });

    // The browser can reject fetch with a non-Error value; both public paths
    // deliberately normalize that hostile shape instead of assuming Error.
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject('offline')));
    await store.loadPresetTools();
    expect(store.getPresetToolsSnapshot().error).toBe('offline');
    await store.setPresetTool('standard', 'bash', false);
    expect(store.getPresetToolsSnapshot().error).toBe('offline');
  });
});
