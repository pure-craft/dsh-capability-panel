import { describe, expect, it } from 'vitest';
import type { InspectorPayload } from '../src/contract.js';
import { parseInspectorPayload } from '../src/wire.js';

function validPayload(): InspectorPayload {
  return {
    sessionId: 's1',
    skills: [{ name: 'find-skills', state: 'loaded', enabled: true, loadCount: 1, description: 'd' }],
    mcp: [
      {
        server: 'yunxiao',
        enabled: false,
        tools: [{ name: 'mcp__yunxiao__list_pipelines', label: 'list_pipelines', enabled: false, description: 'd' }],
      },
    ],
    systemTools: [{ name: 'bash', label: 'bash', enabled: true }],
    blocked: { 'find-skills': 2 },
    degraded: ['partial'],
  };
}

describe('parseInspectorPayload', () => {
  it('accepts a complete payload', () => {
    expect(parseInspectorPayload(validPayload())).toEqual(validPayload());
  });

  it('accepts the minimal shape (null session, empty lists)', () => {
    const minimal = { sessionId: null, skills: [], mcp: [], systemTools: [], blocked: {} };
    expect(parseInspectorPayload(minimal)).toEqual(minimal);
  });

  it('rejects non-objects and missing required fields', () => {
    expect(parseInspectorPayload(null)).toBeNull();
    expect(parseInspectorPayload([])).toBeNull();
    expect(parseInspectorPayload({ sessionId: 's' })).toBeNull();
  });

  it('rejects a skill with an unknown state (version skew surface)', () => {
    const bad = validPayload();
    (bad.skills[0] as { state: string }).state = 'surprised';
    expect(parseInspectorPayload(bad)).toBeNull();
  });

  it('rejects a malformed nested MCP tool instead of dropping it silently', () => {
    const bad = validPayload();
    (bad.mcp[0] as { tools: unknown }).tools = [{ name: 42 }];
    expect(parseInspectorPayload(bad)).toBeNull();
  });

  it('rejects non-numeric blocked counts', () => {
    const bad = validPayload();
    (bad as { blocked: unknown }).blocked = { x: 'many' };
    expect(parseInspectorPayload(bad)).toBeNull();
  });
});
