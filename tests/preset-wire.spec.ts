import { describe, expect, it } from 'vitest';
import { parsePresetToolPayload } from '../src/preset-wire.js';

function basePayload() {
  return {
    writable: true,
    presets: [{
      id: 'alpha',
      name: 'Alpha',
      trust: 'system',
      skills: [] as Record<string, unknown>[],
      mcp: [] as Record<string, unknown>[],
      systemTools: [] as Record<string, unknown>[],
    }],
  };
}

function withSkill(skill: Record<string, unknown>) {
  const payload = basePayload();
  payload.presets[0]!.skills = [skill];
  return payload;
}

function withServer(server: Record<string, unknown>) {
  const payload = basePayload();
  payload.presets[0]!.mcp = [server];
  return payload;
}

describe('preset skill provenance fields', () => {
  const base = { name: 'writing', enabled: true };

  it('carries source, path, and group when present', () => {
    const parsed = parsePresetToolPayload(
      withSkill({ ...base, source: 'custom', path: '~/.agents/skills', group: 'preset:Cordis' }),
    );
    expect(parsed?.presets[0]?.skills[0]).toMatchObject({ source: 'custom', path: '~/.agents/skills', group: 'preset:Cordis' });
  });

  it('rejects non-string provenance fields', () => {
    expect(parsePresetToolPayload(withSkill({ ...base, source: 42 }))).toBeNull();
    expect(parsePresetToolPayload(withSkill({ ...base, path: 42 }))).toBeNull();
    expect(parsePresetToolPayload(withSkill({ ...base, group: 42 }))).toBeNull();
  });
});

describe('preset MCP server source fields', () => {
  const base = { server: 'search', enabled: true, tools: [] };

  it('carries source and path when present', () => {
    const parsed = parsePresetToolPayload(withServer({ ...base, source: 'host', path: '~/.dsh' }));
    expect(parsed?.presets[0]?.mcp[0]).toMatchObject({ source: 'host', path: '~/.dsh' });
  });

  it('rejects non-string source or path', () => {
    expect(parsePresetToolPayload(withServer({ ...base, source: 42 }))).toBeNull();
    expect(parsePresetToolPayload(withServer({ ...base, path: 42 }))).toBeNull();
  });
});
