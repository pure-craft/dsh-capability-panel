/**
 * Shared panel state, owned outside React.
 *
 * Two slots need the same open/closed flag: the toolbar button toggles it, the
 * overlay reads it. They mount in different places, so neither can own the other's
 * state — and component state would be wrong anyway. A tool call settling reorders
 * the conversation flow and remounts components in it; anything held in `useState`
 * there is lost. So the flag and the fetched payload live here, and components
 * subscribe through `useSyncExternalStore`.
 *
 * The store primitive is the host's `createSnapshotStore` (immer-backed,
 * reference-stable snapshots) — not a hand-rolled listener set.
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client';
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
  store.set({ ...store.getSnapshot(), open: !store.getSnapshot().open });
}

export function close(): void {
  if (store.getSnapshot().open) store.set({ ...store.getSnapshot(), open: false });
}

const ROUTE = '/api/agent-toolkit';

/** Guards against a slow answer overwriting a newer one. */
let requestSeq = 0;

async function requestPayload(sessionId: string | null, init?: RequestInit): Promise<InspectorPayload> {
  const query = sessionId === null ? '' : `?session=${encodeURIComponent(sessionId)}`;
  const response = await fetch(`${ROUTE}${query}`, { credentials: 'same-origin', ...init });
  if (!response.ok) {
    // The host answers failures with a JSON { error } carrying the real cause
    // (e.g. "session agent is not available") — surface it, not just the code.
    let detail = '';
    try {
      const body: unknown = await response.json();
      if (body !== null && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
        detail = `：${(body as { error: string }).error}`;
      }
    } catch {
      // Keep the status-only message.
    }
    throw new Error(`HTTP ${response.status}${detail}`);
  }
  // No bare cast: client hot-reloads independently of the host, so a version
  // skew is exactly when the shape diverges — and it must read as an error,
  // never as an empty catalog.
  const payload = parseInspectorPayload(await response.json());
  if (payload === null) throw new Error('unexpected payload shape (host/client version skew?)');
  return payload;
}

export async function refresh(sessionId: string | null): Promise<void> {
  const mine = ++requestSeq;
  store.set({ ...store.getSnapshot(), loading: true, error: null });
  try {
    const payload = await requestPayload(sessionId);
    if (mine !== requestSeq) return;
    store.set({ ...store.getSnapshot(), loading: false, payload, error: null });
  } catch (error) {
    if (mine !== requestSeq) return;
    // Keep the last good payload visible: a stale list beats an empty panel that
    // reads as "you have no skills".
    store.set({
      ...store.getSnapshot(),
      loading: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function setCapability(
  sessionId: string,
  kind: 'skill' | 'mcp-server' | 'mcp-tool' | 'system-tool',
  name: string,
  enabled: boolean,
): Promise<void> {
  const mine = ++requestSeq;
  store.set({ ...store.getSnapshot(), loading: true, error: null });
  try {
    const payload = await requestPayload(sessionId, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, name, enabled }),
    });
    if (mine !== requestSeq) return;
    store.set({ ...store.getSnapshot(), loading: false, payload, error: null });
  } catch (error) {
    if (mine !== requestSeq) return;
    store.set({ ...store.getSnapshot(), loading: false, error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Back to the initial state, on `connection/reset`. The bump of `requestSeq`
 * comes first: an answer from the dead connection must not land afterwards and
 * resurrect a payload the reset just dropped. The panel closes rather than
 * auto-refetching — after a host restart the session it described may be gone,
 * and reopening is one click.
 */
export function reset(): void {
  requestSeq += 1;
  store.set(INITIAL_STATE);
}
