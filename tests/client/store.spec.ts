import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InspectorPayload } from '../../src/contract.js';

// The host's client bundle touches `window` at import time, so tests stub the
// store primitive with a minimal faithful implementation (reference-stable
// snapshot, notify-on-set) — the store's own logic is what's under test.
vi.mock('@deepseek-ai/dsh-client-store', () => ({
  createSnapshotStore<T>(initial: T) {
    let state = initial;
    const listeners = new Set<() => void>();
    return {
      getSnapshot: () => state,
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      set(next: T) {
        state = next;
        for (const listener of listeners) listener();
      },
    };
  },
}));

/** The store is a module singleton: every test gets a fresh copy. */
async function loadStore() {
  return await import('../../src/client/store.js');
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function okResponse(payload: InspectorPayload) {
  return { ok: true, status: 200, json: () => Promise.resolve(payload) } as Response;
}

function payloadOf(sessionId: string | null): InspectorPayload {
  return { sessionId, skills: [], mcp: [], systemTools: [], blocked: {} };
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('toggle / close / subscribe', () => {
  it('toggles open both ways; close is a no-op when already closed', async () => {
    const store = await loadStore();
    const seen: boolean[] = [];
    const unsubscribe = store.subscribe(() => seen.push(store.getSnapshot().open));

    expect(store.getSnapshot().open).toBe(false);
    store.toggle();
    expect(store.getSnapshot().open).toBe(true);
    store.toggle();
    expect(store.getSnapshot().open).toBe(false);
    store.close();
    expect(seen).toEqual([true, false]);
    unsubscribe();
  });

  it('getSnapshot is reference-stable without a commit, and unsubscribe stops notifications', async () => {
    const store = await loadStore();
    const before = store.getSnapshot();
    expect(store.getSnapshot()).toBe(before);

    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    store.toggle();
    unsubscribe();
    store.toggle();
    expect(calls).toBe(1);
  });
});

describe('refresh', () => {
  it('fetches the bare route without a session, and encodes the session param', async () => {
    const store = await loadStore();
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) => {
        calls.push(input);
        return Promise.resolve(okResponse(payloadOf(null)));
      }),
    );

    await store.refresh(null);
    await store.refresh('sess 1');
    expect(calls).toEqual(['/api/agent-toolkit', '/api/agent-toolkit?session=sess%201']);
  });

  it('commits loading first, then the payload', async () => {
    const store = await loadStore();
    const gate = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn(() => gate.promise));
    const payload = payloadOf('s');

    const states: string[] = [];
    store.subscribe(() => {
      const s = store.getSnapshot();
      states.push(`${String(s.loading)}:${s.payload === null ? 'null' : 'data'}`);
    });
    const pending = store.refresh('s');
    gate.resolve(okResponse(payload));
    await pending;

    expect(states).toEqual(['true:null', 'false:data']);
    expect(store.getSnapshot().payload).toStrictEqual(payload);
  });

  it('keeps the last good payload when a later request fails', async () => {
    const store = await loadStore();
    const payload = payloadOf('s');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(okResponse(payload)).mockResolvedValueOnce({ ok: false, status: 500 }));
    await store.refresh('s');
    await store.refresh('s');

    const snap = store.getSnapshot();
    expect(snap.loading).toBe(false);
    expect(snap.error).toBe('HTTP 500');
    expect(snap.payload).toStrictEqual(payload);
  });

  it('ignores a slow answer when a newer request already landed', async () => {
    const store = await loadStore();
    const first = deferred<Response>();
    const second = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise));

    const stalePayload = payloadOf('old');
    const freshPayload = payloadOf('new');
    const p1 = store.refresh('old');
    const p2 = store.refresh('new');
    second.resolve(okResponse(freshPayload));
    await p2;
    first.resolve(okResponse(stalePayload));
    await p1;

    expect(store.getSnapshot().payload).toStrictEqual(freshPayload);
  });
});

describe('setCapability', () => {
  it('posts a per-item capability change and commits the returned payload', async () => {
    const store = await loadStore();
    const updated: InspectorPayload = {
      sessionId: 's',
      skills: [{ name: 'find-skills', state: 'unloaded', enabled: false, loadCount: 0 }],
      mcp: [],
      systemTools: [],
      blocked: {},
    };
    const fetchMock = vi.fn(() => Promise.resolve(okResponse(updated)));
    vi.stubGlobal('fetch', fetchMock);

    await store.setCapability('s', 'skill', 'find-skills', false);

    expect(fetchMock).toHaveBeenCalledWith('/api/agent-toolkit?session=s', {
      credentials: 'same-origin',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'skill', name: 'find-skills', enabled: false }),
    });
    expect(store.getSnapshot().payload).toStrictEqual(updated);
  });
});

describe('reset (connection/reset)', () => {
  it('returns to the initial state', async () => {
    const store = await loadStore();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(okResponse(payloadOf('s')))));
    await store.refresh('s');
    store.toggle();

    store.reset();
    expect(store.getSnapshot()).toEqual({ open: false, loading: false, payload: null, error: null });
  });

  it('invalidates an in-flight answer from the dead connection', async () => {
    const store = await loadStore();
    const gate = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn(() => gate.promise));

    const pending = store.refresh('s');
    store.reset();
    gate.resolve(okResponse(payloadOf('s')));
    await pending;

    expect(store.getSnapshot().payload).toBeNull();
  });
});

describe('error detail extraction', () => {
  it('surfaces the host\'s error field alongside the status code', async () => {
    const store = await loadStore();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'session agent is not available' }),
    })));

    await store.refresh('s');
    expect(store.getSnapshot().error).toBe('HTTP 500：session agent is not available');
  });

  it('keeps the status-only message when the body is not valid JSON', async () => {
    const store = await loadStore();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false,
      status: 502,
      json: () => Promise.reject(new Error('Unexpected token < in JSON')),
    })));

    await store.refresh('s');
    expect(store.getSnapshot().error).toBe('HTTP 502');
  });

  it('keeps the status-only message when the body carries no error string', async () => {
    const store = await loadStore();
    for (const body of [null, 'plain text', { error: 42 }, {}]) {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
        ok: false,
        status: 503,
        json: () => Promise.resolve(body),
      })));
      await store.refresh('s');
      expect(store.getSnapshot().error).toBe('HTTP 503');
    }
  });

  it('reports a non-Error rejection through String()', async () => {
    const store = await loadStore();
    // A fetch layer can surface a bare string; that is the condition under test.
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject('network down')));

    await store.refresh('s');
    expect(store.getSnapshot().error).toBe('network down');
  });
});

describe('setCapability', () => {
  it('posts the toggle and adopts the returned payload', async () => {
    const store = await loadStore();
    const updated = payloadOf('s');
    const fetchMock = vi.fn(() => Promise.resolve(okResponse(updated)));
    vi.stubGlobal('fetch', fetchMock);

    await store.setCapability('s', 'skill', 'find-skills', false);

    expect(fetchMock).toHaveBeenCalledWith('/api/agent-toolkit?session=s', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ kind: 'skill', name: 'find-skills', enabled: false }),
    }));
    expect(store.getSnapshot().payload).toEqual(updated);
    expect(store.getSnapshot().error).toBeNull();
  });

  it('records the failure without clearing the last good payload', async () => {
    const store = await loadStore();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(okResponse(payloadOf('s')))));
    await store.refresh('s');

    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('boom'))));
    await store.setCapability('s', 'skill', 'x', false);

    expect(store.getSnapshot().error).toBe('boom');
    expect(store.getSnapshot().loading).toBe(false);
  });

  it('drops a stale answer when reset lands mid-flight', async () => {
    const store = await loadStore();
    const gate = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn(() => gate.promise));

    const pending = store.setCapability('s', 'skill', 'x', false);
    store.reset();
    gate.resolve(okResponse(payloadOf('s')));
    await pending;

    expect(store.getSnapshot().payload).toBeNull();
  });

  it('drops a stale failure when reset lands mid-flight', async () => {
    const store = await loadStore();
    const gate = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn(() => gate.promise));

    const pending = store.setCapability('s', 'skill', 'x', false);
    store.reset();
    gate.reject(new Error('too late'));
    await pending;

    expect(store.getSnapshot().error).toBeNull();
  });

  it('does not let a later refresh invalidate a mutation response', async () => {
    const store = await loadStore();
    const mutation = deferred<Response>();
    const refresh = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(mutation.promise).mockReturnValueOnce(refresh.promise));
    const changed = payloadOf('changed');

    const writing = store.setCapability('s', 'skill', 'find-skills', false);
    await vi.waitFor(() => { expect(fetch).toHaveBeenCalledTimes(1); });
    const reading = store.refresh('s');
    mutation.resolve(okResponse(changed));
    await writing;
    refresh.resolve(okResponse(payloadOf('stale-read')));
    await reading;

    expect(store.getSnapshot().payload).toStrictEqual(changed);
    expect(store.getSnapshot().loading).toBe(false);
  });

  it('serializes mutations in user intent order', async () => {
    const store = await loadStore();
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    vi.stubGlobal('fetch', fetchMock);

    const disabling = store.setCapability('s', 'skill', 'find-skills', false);
    const enabling = store.setCapability('s', 'skill', 'find-skills', true);
    await vi.waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1); });

    expect(store.getSnapshot().loading).toBe(true);
    first.resolve(okResponse(payloadOf('disabled')));
    await disabling;
    await vi.waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(2); });
    second.resolve(okResponse(payloadOf('enabled')));
    await enabling;

    expect(store.getSnapshot().payload?.sessionId).toBe('enabled');
  });

  it('does not let a refresh overlapping a later mutation commit stale data', async () => {
    const store = await loadStore();
    const refresh = deferred<Response>();
    const mutation = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(refresh.promise).mockReturnValueOnce(mutation.promise));
    const changed = payloadOf('changed');

    const reading = store.refresh('s');
    const writing = store.setCapability('s', 'system-tool', 'bash', false);
    refresh.resolve(okResponse(payloadOf('stale-read')));
    await reading;
    mutation.resolve(okResponse(changed));
    await writing;

    expect(store.getSnapshot().payload).toStrictEqual(changed);
    expect(store.getSnapshot().loading).toBe(false);
  });
});

describe('remaining guards', () => {
  it('close() on an already-closed panel does not notify', async () => {
    const store = await loadStore();
    let notifications = 0;
    const unsubscribe = store.subscribe(() => { notifications += 1; });

    store.close();
    expect(notifications).toBe(0);
    expect(store.getSnapshot().open).toBe(false);
    unsubscribe();
  });

  it('rejects a payload the client cannot parse, rather than showing an empty catalog', async () => {
    const store = await loadStore();
    // A host/client version skew delivers well-formed JSON with the wrong
    // fields; an empty panel would misreport it as "no skills".
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ unexpected: true }),
    })));

    await store.refresh('s');
    expect(store.getSnapshot().error).toMatch(/version skew/);
    expect(store.getSnapshot().payload).toBeNull();
  });

  it('drops a superseded refresh answer so the newer one wins', async () => {
    const store = await loadStore();
    const stale = deferred<Response>();
    const fresh = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise));

    const first = store.refresh('a');
    const second = store.refresh('b');
    // Resolve out of order: the superseded request answers last and must lose.
    fresh.resolve(okResponse(payloadOf('b')));
    await second;
    stale.resolve(okResponse(payloadOf('a')));
    await first;

    expect(store.getSnapshot().payload?.sessionId).toBe('b');
  });

  it('drops a superseded refresh failure so it cannot overwrite a good state', async () => {
    const store = await loadStore();
    const stale = deferred<Response>();
    const fresh = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise));

    const first = store.refresh('a');
    const second = store.refresh('b');
    fresh.resolve(okResponse(payloadOf('b')));
    await second;
    stale.reject(new Error('stale failure'));
    await first;

    expect(store.getSnapshot().error).toBeNull();
    expect(store.getSnapshot().payload?.sessionId).toBe('b');
  });
});

describe('final branches', () => {
  it('close() on an open panel clears the flag', async () => {
    const store = await loadStore();
    store.toggle();
    expect(store.getSnapshot().open).toBe(true);

    store.close();
    expect(store.getSnapshot().open).toBe(false);
  });

  it('a live setCapability failure reaches the panel', async () => {
    const store = await loadStore();
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('toggle rejected'))));

    await store.setCapability('s', 'system-tool', 'bash', false);
    expect(store.getSnapshot().error).toBe('toggle rejected');
  });
});

describe('non-Error rejection in setCapability', () => {
  it('stringifies a thrown non-Error value', async () => {
    const store = await loadStore();
    // A fetch layer can surface a bare string; that is the condition under test.
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject('socket closed')));

    await store.setCapability('s', 'mcp-tool', 'web_search', false);
    expect(store.getSnapshot().error).toBe('socket closed');
  });
});
