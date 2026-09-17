import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';

export type {
  PresetMcpServer as PresetMcpView,
  PresetSkillRow as PresetSkillView,
  PresetToolEntry as PresetToolPresetView,
  PresetToolRow as PresetToolView,
} from '../preset-contract.js';
import type { PresetToolPayload } from '../preset-contract.js';
import { parsePresetToolPayload } from '../preset-wire.js';

export interface PresetToolState {
  readonly loading: boolean;
  readonly payload: PresetToolPayload | null;
  readonly selectedId: string | null;
  readonly error: string | null;
}

const INITIAL: PresetToolState = { loading: false, payload: null, selectedId: null, error: null };
const store = createSnapshotStore<PresetToolState>(INITIAL);
let epoch = 0;
let queue: Promise<void> = Promise.resolve();
let requests = 0;

export const subscribePresetTools = (listener: () => void): (() => void) => store.subscribe(listener);
export const getPresetToolsSnapshot = (): PresetToolState => store.getSnapshot();

async function requestPayload(init?: RequestInit): Promise<PresetToolPayload> {
  const response = await fetch('/api/capability-panel/presets', { credentials: 'same-origin', ...init });
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json() as { error?: unknown };
      if (typeof body.error === 'string') detail = `: ${body.error}`;
    } catch {}
    throw new Error(`HTTP ${response.status}${detail}`);
  }
  const payload = parsePresetToolPayload(await response.json());
  if (payload === null) throw new Error('unexpected preset payload shape (host/client version skew?)');
  return payload;
}

function begin(): number {
  requests += 1;
  store.set({ ...store.getSnapshot(), loading: true, error: null });
  return epoch;
}

function finish(requestEpoch: number, patch: Partial<PresetToolState>): void {
  if (requestEpoch !== epoch) return;
  requests -= 1;
  const current = store.getSnapshot();
  const nextPayload = patch.payload ?? current.payload;
  const selectedExists = nextPayload?.presets.some((preset) => preset.id === current.selectedId) === true;
  store.set({
    ...current,
    ...patch,
    selectedId: selectedExists ? current.selectedId : (nextPayload?.presets[0]?.id ?? null),
    loading: requests > 0,
  });
}

export async function loadPresetTools(): Promise<void> {
  const requestEpoch = begin();
  try {
    finish(requestEpoch, { payload: await requestPayload(), error: null });
  } catch (error) {
    finish(requestEpoch, { error: error instanceof Error ? error.message : String(error) });
  }
}

export function selectPreset(id: string): void {
  const current = store.getSnapshot();
  if (current.payload?.presets.some((preset) => preset.id === id) !== true) return;
  store.set({ ...current, selectedId: id });
}

/** Serialized write: every toggle is one POST whose response is the new truth. */
function mutate(body: { presetId: string; kind: 'tool' | 'mcp-server' | 'skill'; name: string; enabled: boolean }): Promise<void> {
  const requestEpoch = begin();
  const run = async (): Promise<void> => {
    try {
      finish(requestEpoch, {
        payload: await requestPayload({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        error: null,
      });
    } catch (error) {
      finish(requestEpoch, { error: error instanceof Error ? error.message : String(error) });
    }
  };
  const result = queue.then(run);
  queue = result;
  return result;
}

export function setPresetTool(presetId: string, name: string, enabled: boolean): Promise<void> {
  return mutate({ presetId, kind: 'tool', name, enabled });
}

/** Toggle one skill's default for a preset. */
export function setPresetSkill(presetId: string, name: string, enabled: boolean): Promise<void> {
  return mutate({ presetId, kind: 'skill', name, enabled });
}

/** Toggle a whole MCP server in one write instead of one request per tool. */
export function setPresetServer(presetId: string, server: string, enabled: boolean): Promise<void> {
  return mutate({ presetId, kind: 'mcp-server', name: server, enabled });
}

/**
 * Restart one MCP server's connection and take the payload the host reports
 * afterwards. Serialized behind the same queue as the toggles: a restart
 * re-registers every tool of that server, and a toggle landing mid-restart would
 * be answered by a payload the restart then invalidates.
 *
 * The caller needs only success or failure — the refreshed payload is already in
 * the store — so a rejection is the whole result surface.
 */
export function reconnectPresetServer(server: string): Promise<void> {
  const requestEpoch = begin();
  const run = async (): Promise<void> => {
    try {
      const response = await fetch('/api/capability-panel/reconnect', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ server }),
      });
      if (!response.ok) {
        let detail = '';
        try {
          const body = await response.json() as { error?: unknown };
          if (typeof body.error === 'string') detail = `: ${body.error}`;
        } catch {}
        throw new Error(`HTTP ${response.status}${detail}`);
      }
      const payload = parsePresetToolPayload(await response.json());
      if (payload === null) throw new Error('unexpected preset payload shape (host/client version skew?)');
      finish(requestEpoch, { payload, error: null });
    } catch (error) {
      finish(requestEpoch, { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  };
  const result = queue.then(run);
  // Unlike a toggle this one rejects to its caller, so the shared queue must
  // absorb the rejection or every later write would be skipped.
  queue = result.then(() => undefined, () => undefined);
  return result;
}

export function resetPresetTools(): void {
  epoch += 1;
  requests = 0;
  queue = Promise.resolve();
  store.set(INITIAL);
}
