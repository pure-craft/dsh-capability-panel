import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InspectorPayload } from '../../src/contract.js';

// The host's client bundle touches `window` at import time, so tests stub the
// store primitive with a minimal faithful implementation (reference-stable
// snapshot, notify-on-set) — the store's own logic is what's under test.
vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
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
