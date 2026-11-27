import { describe, expect, it } from 'vitest';
import type { InspectorPayload } from '../../src/contract.js';
import type { InsightsPayload } from '../../src/insights-contract.js';
import { insightRows, insightBarPercent, insightsUrl } from '../../src/client/insights-model.js';
import { insightsEn, insightsZh, insightsText } from '../../src/client/insights-locale.js';
import { INSIGHTS_CSS } from '../../src/client/insights-styles.js';

const payload: InsightsPayload = { scope: 'workspace', cwd: '/workspace', presetId: null, coverage: { knownSessions: 3, indexedSessions: 3, complete: true, unknown: false }, tools: [{ name: 'used', count: 4, lastUsed: 1 }, { name: 'historic', count: 2, lastUsed: 1 }], skills: [{ name: 'loaded', count: 2, lastUsed: 1 }], presets: [], warnings: [] };
const inventory: InspectorPayload = { sessionId: 's', blocked: {}, skills: [{ name: 'loaded', state: 'loaded', enabled: true, loadCount: 1, source: 'bundled', provider: 'builtin' }, { name: 'never', state: 'unloaded', enabled: false, loadCount: 0, source: 'bundled', provider: 'builtin' }], systemTools: [{ name: 'used', label: 'Used', enabled: true }, { name: 'zero', label: 'Zero', enabled: true, reserved: true }], mcp: [{ server: 'm', enabled: false, tools: [{ name: 'm/tool', label: 'Tool', enabled: true }] }] };

describe('insights inventory join and ranking', () => {
  it('puts measured unused capabilities first, without giving historical rows controls', () => {
    const rows = insightRows(payload, inventory, 'tools', 'unused');
    expect(rows.map((row) => [row.name, row.count])).toEqual([['m/tool', 0], ['zero', 0], ['historic', 2], ['used', 4]]);
    expect(rows[0]?.control).toEqual({ kind: 'mcp-tool', enabled: false, reserved: false });
    expect(rows[1]?.control?.reserved).toBe(true);
    expect(rows[2]?.control).toBeUndefined();
    expect(rows[3]?.control?.kind).toBe('system-tool');
    expect(inventory.systemTools[0]?.enabled).toBe(true);
  });
  it('honors individual tool switches when the MCP server is enabled', () => {
    const current: InspectorPayload = { ...inventory, mcp: [{ server: 'm', enabled: true, tools: [
      { name: 'm/on', label: 'On', enabled: true },
      { name: 'm/off', label: 'Off', enabled: false, reserved: true },
    ] }] };
    const rows = insightRows(payload, current, 'tools', 'unused');
    expect(rows.find((row) => row.name === 'm/on')?.control).toEqual({ kind: 'mcp-tool', enabled: true, reserved: false });
    expect(rows.find((row) => row.name === 'm/off')?.control).toEqual({ kind: 'mcp-tool', enabled: false, reserved: true });
  });
  it('never interprets incomplete or unknown coverage as zero', () => {
    for (const coverage of [{ ...payload.coverage, complete: false }, { ...payload.coverage, unknown: true }]) {
      const rows = insightRows({ ...payload, coverage }, inventory, 'tools', 'unused');
      expect(rows.map((row) => row.count)).toEqual([2, 4, null, null]);
      expect(insightRows({ ...payload, coverage }, inventory, 'tools', 'most').map((row) => row.count)).toEqual([4, 2, null, null]);
    }
  });
  it('uses skill load counts, and never exposes preset or global writes', () => {
    expect(insightRows(payload, inventory, 'skills', 'most').map((row) => [row.name, row.count, row.control?.kind])).toEqual([['loaded', 2, 'skill'], ['never', 0, 'skill']]);
    expect(insightRows(payload, null, 'tools', 'most').every((row) => row.control === undefined)).toBe(true);
    expect(insightRows({ ...payload, tools: [{ name: 'b', count: 1, lastUsed: null }, { name: 'a', count: 1, lastUsed: null }] }, null, 'tools', 'most').map((row) => row.name)).toEqual(['a', 'b']);
  });
  it('normalizes count bars and safely encodes request dimensions', () => {
    expect(insightBarPercent(null, 5)).toBe(0);
    expect(insightBarPercent(0, 0)).toBe(0);
    expect(insightBarPercent(2, 4)).toBe(50);
    expect(insightBarPercent(10, 4)).toBe(100);
    expect(insightBarPercent(-1, 4)).toBe(0);
    expect(insightsUrl(undefined, 'global', '')).toBe('/api/capability-panel/insights?scope=global');
    expect(insightsUrl('a&b', 'workspace', 'x/y')).toBe('/api/capability-panel/insights?scope=workspace&session=a%26b&preset=x%2Fy');
  });
});

describe('insights localized host-aligned UI', () => {
  it('keeps translated keys equal and has honest missing-data copy', () => {
    expect(Object.keys(insightsZh).sort()).toEqual(Object.keys(insightsEn).sort());
    expect(insightsText('zh-CN', 'unused')).toBe('未使用');
    expect(insightsText('en-US', 'count', { count: 2 })).toBe('2 calls');
    expect(insightsText('fr', 'missing')).toBe('missing');
    expect(insightsText('en', 'count')).toBe('{count} calls');
    expect(insightsText('zh', 'sessionOnly')).toContain('不会自动关闭');
    expect(insightsText('en', 'insufficient')).toContain('not counted as zero');
  });
  it('uses theme tokens and content stacking instead of a nested scroll area', () => {
    expect(INSIGHTS_CSS).toContain('--dsw-alias-label-primary');
    // Static CSS guard only: tolerate formatting and leave actual layout to
    // browser verification rather than locking a typography serialization.
    expect(INSIGHTS_CSS).not.toMatch(/overflow(?:-y)?\s*:\s*(?:auto|scroll)\b/i);
    expect(INSIGHTS_CSS).not.toMatch(/flex\s*:\s*1\s+1\s+0(?:px|%)?\s*(?:;|})/i);
  });
});
