import type { InspectorPayload } from '../contract.js';
import type { InsightsPayload } from '../insights-contract.js';

export interface InsightRow {
  readonly name: string;
  readonly label: string;
  readonly count: number | null;
  readonly control?: { readonly kind: 'skill' | 'mcp-tool' | 'system-tool'; readonly enabled: boolean; readonly reserved: boolean };
}

/** Usage is read-only. Controls always come from the current session inventory. */
export function insightRows(payload: InsightsPayload, inventory: InspectorPayload | null, category: 'tools' | 'skills', order: 'unused' | 'most'): InsightRow[] {
  const rows = new Map<string, InsightRow>();
  const missingCount = payload.coverage.complete && !payload.coverage.unknown ? 0 : null;
  if (inventory !== null) {
    if (category === 'skills') {
      for (const skill of inventory.skills) rows.set(skill.name, { name: skill.name, label: skill.name, count: missingCount, control: { kind: 'skill', enabled: skill.enabled, reserved: false } });
    } else {
      for (const tool of inventory.systemTools) rows.set(tool.name, { name: tool.name, label: tool.label, count: missingCount, control: { kind: 'system-tool', enabled: tool.enabled, reserved: tool.reserved === true } });
      for (const server of inventory.mcp) for (const tool of server.tools) rows.set(tool.name, { name: tool.name, label: tool.label, count: missingCount, control: { kind: 'mcp-tool', enabled: server.enabled && tool.enabled, reserved: tool.reserved === true } });
    }
  }
  for (const usage of payload[category]) {
    const row = rows.get(usage.name);
    rows.set(usage.name, row === undefined ? { name: usage.name, label: usage.name, count: usage.count } : { ...row, count: usage.count });
  }
  return [...rows.values()].sort((a, b) => {
    // Unknowns are not unused: keep them after measured entries in both orders.
    if (a.count === null) return b.count === null ? a.name.localeCompare(b.name) : 1;
    if (b.count === null) return -1;
    return (order === 'unused' ? a.count - b.count : b.count - a.count) || a.name.localeCompare(b.name);
  });
}

export function insightBarPercent(count: number | null, maximum: number): number {
  return count === null || maximum <= 0 ? 0 : Math.min(100, Math.max(0, count / maximum * 100));
}

export function insightsUrl(sessionId: string | undefined, scope: 'workspace' | 'global', preset: string): string {
  const params = new URLSearchParams({ scope });
  if (sessionId !== undefined) params.set('session', sessionId);
  if (preset !== '') params.set('preset', preset);
  return `/api/capability-panel/insights?${params.toString()}`;
}
