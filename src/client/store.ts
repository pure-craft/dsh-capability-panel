import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';
import type { InspectorPayload } from '../contract.js';
import { parseInspectorPayload } from '../wire.js';

export interface InspectorState {
  readonly open: boolean;
  readonly loading: boolean;
  readonly payload: InspectorPayload | null;
  /** Transport-level failure, distinct from `payload.degraded` (partial reads). */
  readonly error: string | null;
}

const INITIAL_STATE: InspectorState = { open: false, loading: false, payload: null, error: null };
const store = createSnapshotStore<InspectorState>(INITIAL_STATE);

export const subscribe = (listener: () => void): (() => void) => store.subscribe(listener);
/** Reference-stable while nothing changed, as useSyncExternalStore requires. */
export const getSnapshot = (): InspectorState => store.getSnapshot();

export function toggle(): void {
  const snapshot = store.getSnapshot();
  store.set({ ...snapshot, open: !snapshot.open });
}

export function close(): void {
  const snapshot = store.getSnapshot();
  if (snapshot.open) store.set({ ...snapshot, open: false });
}

const ROUTE = '/api/capability-panel';

/**
 * Reads and writes have different ordering domains. A newer refresh supersedes
 * an older refresh, but it cannot invalidate a user's mutation response.
 * `mutationVersion` changes at both ends of a write, so a GET overlapping a
 * mutation cannot commit a possibly pre-write snapshot. `epoch` invalidates
 * every answer from a dead connection.
 */
let epoch = 0;
let refreshSeq = 0;
let mutationVersion = 0;
let activeRequests = 0;
let mutationQueue: Promise<void> = Promise.resolve();

function beginRequest(): number {
  activeRequests += 1;
  const snapshot = store.getSnapshot();
  store.set({ ...snapshot, loading: true, error: null });
  return epoch;
}

function finishRequest(requestEpoch: number, patch?: Partial<InspectorState>): void {
  if (requestEpoch !== epoch) return;
  activeRequests -= 1;
  if (patch === undefined && activeRequests > 0) return;
  store.set({ ...store.getSnapshot(), ...patch, loading: activeRequests > 0 });
}

async function requestPayload(sessionId: string | null, init?: RequestInit): Promise<InspectorPayload> {
  const query = sessionId === null ? '' : `?session=${encodeURIComponent(sessionId)}`;
  const response = await fetch(`${ROUTE}${query}`, { credentials: 'same-origin', ...init });
  if (!response.ok) {
    let detail = '';
    try {
      const body: unknown = await response.json();
      if (body !== null && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
        detail = `：${(body as { error: string }).error}`;
      }
    } catch {
      // A non-JSON error still has a useful HTTP status.
    }
    throw new Error(`HTTP ${response.status}${detail}`);
  }
  const payload = parseInspectorPayload(await response.json());
  if (payload === null) throw new Error('unexpected payload shape (host/client version skew?)');
  return payload;
}

export async function refresh(sessionId: string | null): Promise<void> {
  const requestEpoch = beginRequest();
  const mine = ++refreshSeq;
  const mutationAtStart = mutationVersion;
  let patch: Partial<InspectorState> | undefined;
  try {
    const payload = await requestPayload(sessionId);
    if (requestEpoch === epoch && mine === refreshSeq && mutationAtStart === mutationVersion) {
      patch = { payload, error: null };
    }
  } catch (error) {
    if (requestEpoch === epoch && mine === refreshSeq && mutationAtStart === mutationVersion) {
      // Keep the last good payload visible: stale data plus an explicit error is
      // safer than an empty panel that falsely reads as "no capabilities".
      patch = { error: error instanceof Error ? error.message : String(error) };
    }
  } finally {
    finishRequest(requestEpoch, patch);
  }
}

export function setCapability(
  sessionId: string,
  kind: 'skill' | 'mcp-server' | 'mcp-tool' | 'system-tool',
  name: string,
  enabled: boolean,
): Promise<void> {
  const requestEpoch = beginRequest();
  mutationVersion += 1;
  const run = async (): Promise<void> => {
    let patch: Partial<InspectorState> | undefined;
    try {
      const payload = await requestPayload(sessionId, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, name, enabled }),
      });
      if (requestEpoch === epoch) patch = { payload, error: null };
    } catch (error) {
      if (requestEpoch === epoch) patch = { error: error instanceof Error ? error.message : String(error) };
    } finally {
      if (requestEpoch === epoch) mutationVersion += 1;
      finishRequest(requestEpoch, patch);
    }
  };
  // The queue tail is normalized below, so it is always fulfilled here.
  const result = mutationQueue.then(run);
  // run absorbs transport failures into the store, so the queue stays fulfilled.
  mutationQueue = result;
  return result;
}

export function reset(): void {
  epoch += 1;
  refreshSeq += 1;
  mutationVersion += 1;
  activeRequests = 0;
  mutationQueue = Promise.resolve();
  store.set(INITIAL_STATE);
}
