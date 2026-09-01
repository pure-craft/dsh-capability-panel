import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client';

export interface PresetToolView {
  readonly name: string;
  readonly label: string;
  readonly description?: string;
  readonly enabled: boolean;
  readonly reserved?: boolean;
}

export interface PresetSkillView {
  readonly name: string;
  readonly description?: string;
  readonly enabled: boolean;
  /** Discovered under the harness workspace's project root; conditional. */
  readonly project?: boolean;
}

export interface PresetMcpView {
  readonly server: string;
  readonly tools: readonly PresetToolView[];
  readonly enabled: boolean;
}

export interface PresetToolPresetView {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly trust: 'system' | 'user';
  /** Why this preset cannot compose a session; absent when it can. */
  readonly broken?: string;
  readonly skills: readonly PresetSkillView[];
  readonly mcp: readonly PresetMcpView[];
  readonly systemTools: readonly PresetToolView[];
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

function parseTools(raw: readonly unknown[]): PresetToolView[] | null {
  const tools: PresetToolView[] = [];
  for (const rawTool of raw) {
    if (rawTool === null || typeof rawTool !== 'object') return null;
    const tool = rawTool as { name?: unknown; label?: unknown; description?: unknown; enabled?: unknown; reserved?: unknown };
    if (typeof tool.name !== 'string' || typeof tool.label !== 'string' || typeof tool.enabled !== 'boolean') return null;
    if (tool.description !== undefined && typeof tool.description !== 'string') return null;
    if (tool.reserved !== undefined && typeof tool.reserved !== 'boolean') return null;
    tools.push({
      name: tool.name,
      label: tool.label,
      ...(tool.description === undefined ? {} : { description: tool.description }),
      enabled: tool.enabled,
      ...(tool.reserved === undefined ? {} : { reserved: tool.reserved }),
    });
  }
  return tools;
}

function parseSkills(raw: readonly unknown[]): PresetSkillView[] | null {
  const skills: PresetSkillView[] = [];
  for (const rawSkill of raw) {
    if (rawSkill === null || typeof rawSkill !== 'object') return null;
    const skill = rawSkill as { name?: unknown; description?: unknown; enabled?: unknown; project?: unknown };
    if (typeof skill.name !== 'string' || typeof skill.enabled !== 'boolean') return null;
    if (skill.description !== undefined && typeof skill.description !== 'string') return null;
    if (skill.project !== undefined && typeof skill.project !== 'boolean') return null;
    skills.push({
      name: skill.name,
      ...(skill.description === undefined ? {} : { description: skill.description }),
      enabled: skill.enabled,
      ...(skill.project === undefined ? {} : { project: skill.project }),
    });
  }
  return skills;
}

function parsePayload(value: unknown): PresetToolPayload | null {
  if (value === null || typeof value !== 'object') return null;
  const candidate = value as { presets?: unknown; writable?: unknown };
  if (!Array.isArray(candidate.presets) || typeof candidate.writable !== 'boolean') return null;
  const presets: PresetToolPresetView[] = [];
  for (const raw of candidate.presets) {
    if (raw === null || typeof raw !== 'object') return null;
    const preset = raw as { id?: unknown; name?: unknown; description?: unknown; broken?: unknown; trust?: unknown; skills?: unknown; mcp?: unknown; systemTools?: unknown };
    if (typeof preset.id !== 'string' || typeof preset.name !== 'string' || (preset.trust !== 'system' && preset.trust !== 'user')) return null;
    if (!Array.isArray(preset.mcp) || !Array.isArray(preset.systemTools) || !Array.isArray(preset.skills)) return null;
    if (preset.description !== undefined && typeof preset.description !== 'string') return null;
    if (preset.broken !== undefined && typeof preset.broken !== 'string') return null;
    const systemTools = parseTools(preset.systemTools);
    if (systemTools === null) return null;
    const skills = parseSkills(preset.skills);
    if (skills === null) return null;
    const mcp: PresetMcpView[] = [];
    for (const rawServer of preset.mcp) {
      if (rawServer === null || typeof rawServer !== 'object') return null;
      const server = rawServer as { server?: unknown; tools?: unknown; enabled?: unknown };
      if (typeof server.server !== 'string' || typeof server.enabled !== 'boolean' || !Array.isArray(server.tools)) return null;
      const tools = parseTools(server.tools);
      if (tools === null) return null;
      mcp.push({ server: server.server, tools, enabled: server.enabled });
    }
    presets.push({
      id: preset.id,
      name: preset.name,
      ...(preset.description === undefined ? {} : { description: preset.description }),
      ...(preset.broken === undefined ? {} : { broken: preset.broken }),
      trust: preset.trust,
      skills,
      mcp,
      systemTools,
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

export function resetPresetTools(): void {
  epoch += 1;
  requests = 0;
  queue = Promise.resolve();
  store.set(INITIAL);
}
