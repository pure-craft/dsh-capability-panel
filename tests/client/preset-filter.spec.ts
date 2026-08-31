/**
 * The preset filter must behave exactly like the session panel's filter, since
 * both scopes present the same rows to the same query. These cases mirror
 * `tests/client/filter.spec.ts` so a divergence in one shows up as a failure.
 */
import { describe, expect, it } from 'vitest';
import { filterPreset } from '../../src/client/preset-filter.js';
import type { PresetToolPresetView } from '../../src/client/preset-store.js';

const preset: PresetToolPresetView = {
  id: 'alpha',
  name: 'Alpha',
  trust: 'system',
  mcp: [
    {
      server: 'search',
      enabled: true,
      tools: [
        { name: 'mcp__search__web', label: 'web', description: 'lookup the internet', enabled: true },
        { name: 'mcp__search__image', label: 'image', enabled: true },
      ],
    },
    {
      server: 'files',
      enabled: false,
      tools: [{ name: 'mcp__files__read', label: 'read', enabled: false }],
    },
  ],
  systemTools: [
    { name: 'bash', label: 'bash', description: 'run a shell command', enabled: true },
    { name: 'run_code', label: 'run_code', enabled: true, reserved: true },
  ],
};

describe('preset filter', () => {
  it('returns everything for an empty or blank query', () => {
    for (const query of ['', '   ']) {
      const view = filterPreset(preset, query);
      expect(view.mcp).toHaveLength(2);
      expect(view.systemTools).toHaveLength(2);
      expect(view.total).toBe(4);
    }
  });

  it('keeps every tool of a server whose own name matches', () => {
    const view = filterPreset(preset, 'SEARCH');
    expect(view.mcp).toHaveLength(1);
    expect(view.mcp[0]?.tools).toHaveLength(2);
    expect(view.systemTools).toHaveLength(0);
  });

  it('keeps only matching tools and drops a server left with none', () => {
    const view = filterPreset(preset, 'image');
    expect(view.mcp).toHaveLength(1);
    expect(view.mcp[0]?.tools.map((tool) => tool.label)).toEqual(['image']);
    expect(view.total).toBe(1);
  });

  it('matches a system tool on label, wire name or description', () => {
    expect(filterPreset(preset, 'bash').systemTools).toHaveLength(1);
    expect(filterPreset(preset, 'run_code').systemTools).toHaveLength(1);
    expect(filterPreset(preset, 'shell command').systemTools.map((tool) => tool.label)).toEqual(['bash']);
  });

  it('matches an MCP tool on its full wire name and its description', () => {
    expect(filterPreset(preset, 'mcp__files__read').mcp).toHaveLength(1);
    expect(filterPreset(preset, 'lookup the internet').mcp[0]?.tools.map((tool) => tool.label)).toEqual(['web']);
  });

  it('reports nothing for a query that matches neither side', () => {
    const view = filterPreset(preset, 'nonexistent');
    expect(view.mcp).toHaveLength(0);
    expect(view.systemTools).toHaveLength(0);
    expect(view.total).toBe(0);
  });
});
