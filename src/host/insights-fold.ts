import { z } from 'zod';

export const INSIGHTS_KEY = 'capabilityInsights';
const usageSchema = z.object({ count: z.number().int().nonnegative(), lastUsed: z.number().nullable() });
export const insightsStateSchema = z.object({
  inherited: z.number().int().nonnegative(),
  presetId: z.string().nullable(),
  tools: z.record(z.string(), usageSchema),
  skills: z.record(z.string(), usageSchema),
  pending: z.array(z.string()),
  limited: z.boolean(),
});
export type InsightsState = z.infer<typeof insightsStateSchema>;
export interface InsightsHeader { readonly id: string; readonly cwd?: string; readonly agentPreset?: string }
export interface InsightsEvent { readonly type: string; readonly seq: number; readonly time: number; readonly data: unknown }
export function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}
export function initInsights(header: InsightsHeader, inherited: number): InsightsState {
  return { inherited, presetId: header.agentPreset ?? null, tools: {}, skills: {}, pending: [], limited: false };
}
function book(state: InsightsState, kind: 'tools' | 'skills', name: string, time: number): InsightsState {
  const old = Object.hasOwn(state[kind], name) ? state[kind][name] : undefined;
  if (old === undefined && Object.keys(state[kind]).length >= 2000) return { ...state, limited: true };
  return { ...state, [kind]: { ...state[kind], [name]: {
    count: (old?.count ?? 0) + 1,
    lastUsed: Number.isFinite(time) ? Math.max(old?.lastUsed ?? time, time) : old?.lastUsed ?? null,
  } } };
}
function skillContentName(message: Record<string, unknown>): string | null {
  if (message['isError'] === true || !Array.isArray(message['content'])) return null;
  for (const block of message['content']) {
    const text = recordOf(block)['text'];
    if (typeof text !== 'string') continue;
    const match = /<skill_content\s+name="([^"]+)"/.exec(text);
    if (match !== null) return match[1]!;
  }
  return null;
}
export function applyInsights(state: InsightsState, event: InsightsEvent): InsightsState {
  const data = recordOf(event.data);
  if (event.type === 'agent-preset/selected' && typeof data['agentPreset'] === 'string') {
    return data['agentPreset'] === state.presetId ? state : { ...state, presetId: data['agentPreset'] };
  }
  if (event.seq < state.inherited) return state;
  if (event.type === 'user/message' || event.type === 'developer/message') {
    const message = event.type === 'developer/message' ? recordOf(data['message']) : data;
    const source = recordOf(message['source']);
    return source['kind'] === 'skill-invocation' && typeof source['name'] === 'string' && source['name'] !== ''
      ? book(state, 'skills', source['name'], event.time) : state;
  }
  if (event.type === 'tool/call') {
    const name = data['name'];
    if (typeof name !== 'string' || name === '') return state;
    const next = book(state, 'tools', name, event.time);
    const id = data['callId'];
    if (name !== 'skill' || typeof id !== 'string' || id === '' || next.pending.includes(id)) return next;
    return { ...next, pending: [...next.pending, id].slice(-200), limited: next.limited || next.pending.length >= 200 };
  }
  if (event.type !== 'tool/result') return state;
  const message = recordOf(data['message']);
  const id = message['toolCallId'] ?? recordOf(message['source'])['callId'];
  if (typeof id !== 'string' || !state.pending.includes(id)) return state;
  const next = { ...state, pending: state.pending.filter(value => value !== id) };
  const name = data['error'] === undefined ? skillContentName(message) : null;
  return name === null ? next : book(next, 'skills', name, event.time);
}
export function createInsightsDefinition() {
  return {
    key: INSIGHTS_KEY,
    stateVersion: 1,
    stateSchema: insightsStateSchema,
    init: initInsights,
    apply: applyInsights,
    wire: { viewSchema: insightsStateSchema, view: (state: InsightsState) => state },
  };
}
