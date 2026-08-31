import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client';

export interface PresetToolView {
  readonly name: string;
  readonly description?: string;
  readonly enabled: boolean;
  readonly reserved?: boolean;
}

export interface PresetToolPresetView {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly trust: 'system' | 'user';
  /** Why this preset cannot compose a session; absent when it can. */
  readonly broken?: string;
  readonly tools: readonly PresetToolView[];
}

export interface PresetToolPayload {
  readonly presets: readonly PresetToolPresetView[];
  readonly writable: boolean;
}

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

function parsePayload(value: unknown): PresetToolPayload | null {
  if (value === null || typeof value !== 'object') return null;
  const candidate = value as { presets?: unknown; writable?: unknown };
  if (!Array.isArray(candidate.presets) || typeof candidate.writable !== 'boolean') return null;
  const presets: PresetToolPresetView[] = [];
  for (const raw of candidate.presets) {
    if (raw === null || typeof raw !== 'object') return null;
    const preset = raw as { id?: unknown; name?: unknown; description?: unknown; broken?: unknown; trust?: unknown; tools?: unknown };
    if (typeof preset.id !== 'string' || typeof preset.name !== 'string' || (preset.trust !== 'system' && preset.trust !== 'user') || !Array.isArray(preset.tools)) return null;
    if (preset.description !== undefined && typeof preset.description !== 'string') return null;
    if (preset.broken !== undefined && typeof preset.broken !== 'string') return null;
    const tools: PresetToolView[] = [];
    for (const rawTool of preset.tools) {
      if (rawTool === null || typeof rawTool !== 'object') return null;
      const tool = rawTool as { name?: unknown; description?: unknown; enabled?: unknown; reserved?: unknown };
      if (typeof tool.name !== 'string' || typeof tool.enabled !== 'boolean') return null;
      if (tool.description !== undefined && typeof tool.description !== 'string') return null;
      if (tool.reserved !== undefined && typeof tool.reserved !== 'boolean') return null;
      tools.push({
        name: tool.name,
        ...(tool.description === undefined ? {} : { description: tool.description }),
        enabled: tool.enabled,
        ...(tool.reserved === undefined ? {} : { reserved: tool.reserved }),
      });
    }
    presets.push({
      id: preset.id,
      name: preset.name,
      ...(preset.description === undefined ? {} : { description: preset.description }),
      ...(preset.broken === undefined ? {} : { broken: preset.broken }),
      trust: preset.trust,
      tools,
    });
  }
  return { presets, writable: candidate.writable };
}

async function requestPayload(init?: RequestInit): Promise<PresetToolPayload> {
  const response = await fetch('/api/agent-toolkit/presets', { credentials: 'same-origin', ...init });
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json() as { error?: unknown };
      if (typeof body.error === 'string') detail = `：${body.error}`;
    } catch {}
    throw new Error(`HTTP ${response.status}${detail}`);
  }
  const payload = parsePayload(await response.json());
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

export function setPresetTool(presetId: string, name: string, enabled: boolean): Promise<void> {
  const requestEpoch = begin();
  const run = async (): Promise<void> => {
    try {
      finish(requestEpoch, {
        payload: await requestPayload({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ presetId, name, enabled }),
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

export function resetPresetTools(): void {
  epoch += 1;
  requests = 0;
  queue = Promise.resolve();
  store.set(INITIAL);
}
