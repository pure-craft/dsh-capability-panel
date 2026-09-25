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

describe('preset MCP server offline fields', () => {
  const base = { server: 'x', enabled: false, tools: [] };

  it('carries unavailable and reconnectable when present', () => {
    const parsed = parsePresetToolPayload(withServer({ ...base, unavailable: true, reconnectable: true }));
    expect(parsed?.presets[0]?.mcp[0]).toMatchObject({ unavailable: true, reconnectable: true });
    const plain = parsePresetToolPayload(withServer(base));
    expect(plain?.presets[0]?.mcp[0]).not.toHaveProperty('unavailable');
    expect(plain?.presets[0]?.mcp[0]).not.toHaveProperty('reconnectable');
  });

  it('rejects non-boolean unavailable or reconnectable', () => {
    expect(parsePresetToolPayload(withServer({ ...base, unavailable: 'yes' }))).toBeNull();
    expect(parsePresetToolPayload(withServer({ ...base, reconnectable: 1 }))).toBeNull();
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

describe('preset trust field (optional since dsh 0.1.7)', () => {
  it('accepts a row with no trust and omits the key from the parsed entry', () => {
    const payload = basePayload();
    delete (payload.presets[0] as Record<string, unknown>)['trust'];
    const parsed = parsePresetToolPayload(payload);
    expect(parsed?.presets[0]).toBeDefined();
    expect(parsed?.presets[0]).not.toHaveProperty('trust');
  });

  it('still carries a valid trust through', () => {
    const parsed = parsePresetToolPayload(basePayload());
    expect(parsed?.presets[0]?.trust).toBe('system');
  });

  it('rejects an unexpected trust value', () => {
    const payload = basePayload();
    (payload.presets[0] as Record<string, unknown>)['trust'] = 'other';
    expect(parsePresetToolPayload(payload)).toBeNull();
  });
});
