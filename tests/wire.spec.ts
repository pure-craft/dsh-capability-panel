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

describe('rejection paths, the version-skew defence', () => {
  /** Parse a payload with one field replaced by a malformed value. */
  function withField(field: string, value: unknown): unknown {
    return { ...validPayload(), [field]: value };
  }

  it('rejects a tool entry whose enabled flag is not a boolean', () => {
    const payload = withField('systemTools', [{ name: 'bash', label: 'bash', enabled: 'yes' }]);
    expect(parseInspectorPayload(payload)).toBeNull();
  });

  it('rejects a tool entry that is not a record at all', () => {
    for (const bad of [null, 'bash', 42, []]) {
      expect(parseInspectorPayload(withField('systemTools', [bad]))).toBeNull();
    }
  });

  it('carries the reserved flag through when present, and omits it otherwise', () => {
    const reserved = withField('systemTools', [
      { name: 'run_code', label: 'run_code', enabled: true, reserved: true },
      { name: 'bash', label: 'bash', enabled: true },
    ]);
    const parsed = parseInspectorPayload(reserved);
    expect(parsed?.systemTools[0]?.reserved).toBe(true);
    expect(parsed?.systemTools[1]).not.toHaveProperty('reserved');
  });

  it('rejects an MCP server missing its name or enabled flag', () => {
    expect(parseInspectorPayload(withField('mcp', [{ enabled: true, tools: [] }]))).toBeNull();
    expect(parseInspectorPayload(withField('mcp', [{ server: 'x', tools: [] }]))).toBeNull();
    expect(parseInspectorPayload(withField('mcp', [null]))).toBeNull();
  });

  it('rejects an MCP server whose tools field is not an array', () => {
    expect(parseInspectorPayload(withField('mcp', [{ server: 'x', enabled: true, tools: {} }]))).toBeNull();
  });

  it('rejects an MCP server carrying a malformed tool', () => {
    const bad = withField('mcp', [{ server: 'x', enabled: true, tools: [{ name: 'a' }] }]);
    expect(parseInspectorPayload(bad)).toBeNull();
  });

  it('rejects a blocked map that is not a record, or holds a non-number', () => {
    for (const bad of [null, [], 'none']) {
      expect(parseInspectorPayload(withField('blocked', bad))).toBeNull();
    }
    expect(parseInspectorPayload(withField('blocked', { bash: 'many' }))).toBeNull();
  });

  it('rejects a degraded field that is not an array of strings', () => {
    expect(parseInspectorPayload(withField('degraded', 'partial'))).toBeNull();
    expect(parseInspectorPayload(withField('degraded', ['ok', 42]))).toBeNull();
  });

  it('accepts a payload with no degraded field', () => {
    const { degraded: _degraded, ...rest } = validPayload();
    const parsed = parseInspectorPayload(rest);
    expect(parsed).not.toBeNull();
    expect(parsed?.degraded).toBeUndefined();
  });

  it('rejects a non-record payload outright', () => {
    for (const bad of [null, undefined, 'payload', 42, []]) {
      expect(parseInspectorPayload(bad)).toBeNull();
    }
  });
});

describe('skill entry rejection', () => {
  function withSkill(skill: unknown): unknown {
    return { ...validPayload(), skills: [skill] };
  }

  it('rejects a skill that is not a record, or has no name', () => {
    for (const bad of [null, 'find-skills', 42, [], { state: 'loaded' }]) {
      expect(parseInspectorPayload(withSkill(bad))).toBeNull();
    }
  });

  it('rejects an unknown load state', () => {
    const base = { name: 'x', enabled: true, loadCount: 1 };
    for (const state of ['pending', '', null, undefined, 42]) {
      expect(parseInspectorPayload(withSkill({ ...base, state }))).toBeNull();
    }
  });

  it('rejects a skill whose enabled flag or loadCount has the wrong type', () => {
    const base = { name: 'x', state: 'loaded' };
    expect(parseInspectorPayload(withSkill({ ...base, enabled: 'yes', loadCount: 1 }))).toBeNull();
    expect(parseInspectorPayload(withSkill({ ...base, enabled: true, loadCount: '1' }))).toBeNull();
  });

  it('treats a non-string description as absent rather than fatal', () => {
    const parsed = parseInspectorPayload(
      withSkill({ name: 'x', state: 'unloaded', enabled: true, loadCount: 0, description: 42 }),
    );
    expect(parsed?.skills[0]?.description).toBeUndefined();
  });
});
