import { describe, expect, it } from 'vitest';
import { buildPayload, coerceString, displayPath, dshHome, EMPTY_STATE, parentDir, readMcp, readSystemTools } from '../../src/host/catalog.js';

describe('coerceString', () => {
  it('returns the value when it is a string', () => {
    expect(coerceString('hello', 'fallback')).toBe('hello');
  });

  it('returns the fallback when the value is not a string', () => {
    expect(coerceString(42, 'fallback')).toBe('fallback');
    expect(coerceString(null, 'fallback')).toBe('fallback');
    expect(coerceString(undefined, 'fallback')).toBe('fallback');
  });
});

describe('parentDir', () => {
  it('returns the parent of a nested directory', () => {
    expect(parentDir('/agents/skills/lark-base')).toBe('/agents/skills');
  });

  it('tolerates trailing slashes and Windows separators', () => {
    expect(parentDir('/agents/skills/')).toBe('/agents');
    expect(parentDir('C:\\skills\\lark-base')).toBe('C:\\skills');
  });

  it('keeps a rootless or root path unchanged', () => {
    expect(parentDir('skills')).toBe('skills');
    expect(parentDir('/')).toBe('/');
  });
});

describe('displayPath', () => {
  it('makes a path under the session cwd relative', () => {
    expect(displayPath('/repo/.dsh/skills', '/repo')).toBe('.dsh/skills');
  });

  it('abbreviates the user home as ~', () => {
    const home = process.env['HOME']!;
    expect(displayPath(`${home}/.dsh/skills`)).toBe('~/.dsh/skills');
  });

  it('leaves paths outside home and cwd absolute', () => {
    expect(displayPath('/opt/skills')).toBe('/opt/skills');
  });

  it('ignores an empty cwd and a non-prefix cwd', () => {
    expect(displayPath('/repo2/skills', '')).toBe('/repo2/skills');
    expect(displayPath('/repo2/skills', '/repo')).toBe('/repo2/skills');
  });

  it('stays absolute when HOME is unset or empty', () => {
    const real = process.env['HOME'];
    try {
      delete process.env['HOME'];
      expect(displayPath('/x/skills')).toBe('/x/skills');
      process.env['HOME'] = '';
      expect(displayPath('/x/skills')).toBe('/x/skills');
    } finally {
      if (real === undefined) delete process.env['HOME'];
      else process.env['HOME'] = real;
    }
  });
});

describe('system-tool catalog diagnostics', () => {
  it('reports a missing tools service when read independently', () => {
    const degraded: string[] = [];
    const services = { get: () => undefined };

    expect(readSystemTools(services as never, degraded, new Set())).toEqual([]);
    expect(degraded).toEqual(['tools service unavailable']);
  });

  it('does not duplicate a diagnostic already emitted by the MCP reader', () => {
    const degraded = ['tools service unavailable'];
    const services = { get: () => undefined };

    readSystemTools(services as never, degraded, new Set());
    expect(degraded).toEqual(['tools service unavailable']);
  });
});

describe('MCP source detection', () => {
  const hostMcpNames = ['mcp__hostsvr__tool_a', 'mcp__hostsvr__tool_b'];
  const presetMcpNames = ['mcp__preset__tool_x'];

  function makeToolsService(hostNames: string[], presetNames: string[]) {
    const hostSchemas = hostNames.map((name) => ({ name, description: '' }));
    const agentSchemas = [...hostSchemas, ...presetNames.map((name) => ({ name, description: '' }))];
    return {
      schemas(scope?: unknown) {
        return scope === undefined ? hostSchemas : agentSchemas;
      },
    };
  }

  it('marks all-host MCP servers with source "host"', () => {
    const degraded: string[] = [];
    const tools = makeToolsService(hostMcpNames, []);
    const services = { get: () => tools };
    const result = readMcp(services as never, degraded, new Set(), new Set());
    expect(result).toHaveLength(1);
    expect(result[0]?.source).toBe('host');
  });

  it('marks preset-only MCP servers with the preset name', () => {
    const degraded: string[] = [];
    const tools = makeToolsService(hostMcpNames, presetMcpNames);
    const services = { get: () => tools };
    const agent = {} as never;
    const result = readMcp(services as never, degraded, new Set(), new Set(), agent, 'my-preset');
    const presetServer = result.find((s) => s.server === 'preset');
    expect(presetServer?.source).toBe('my-preset');
  });

  it('falls back to "preset" when preset name is unknown', () => {
    const degraded: string[] = [];
    const tools = makeToolsService(hostMcpNames, presetMcpNames);
    const services = { get: () => tools };
    const agent = {} as never;
    const result = readMcp(services as never, degraded, new Set(), new Set(), agent, undefined);
    const presetServer = result.find((s) => s.server === 'preset');
    expect(presetServer?.source).toBe('preset');
  });

  it('reports tools service unavailable gracefully', () => {
    const degraded: string[] = [];
    const services = { get: () => undefined };
    expect(readMcp(services as never, degraded, new Set(), new Set())).toEqual([]);
    expect(degraded).toEqual(['tools service unavailable']);
  });

  it('labels a host server with the DSH home path', () => {
    const degraded: string[] = [];
    const tools = makeToolsService(hostMcpNames, []);
    const services = { get: () => tools };
    const result = readMcp(services as never, degraded, new Set(), new Set());
    expect(result[0]?.path).toBe(displayPath(process.env['DSH_HOME']!));
  });

  it('labels a preset server with the preset path when known', () => {
    const degraded: string[] = [];
    const tools = makeToolsService(hostMcpNames, presetMcpNames);
    const services = { get: () => tools };
    const agent = {} as never;
    const withPath = readMcp(services as never, degraded, new Set(), new Set(), agent, 'my-preset', '/presets/mine');
    expect(withPath.find((s) => s.server === 'preset')?.path).toBe('/presets/mine');
    const withoutPath = readMcp(services as never, degraded, new Set(), new Set(), agent, 'my-preset');
    expect(withoutPath.find((s) => s.server === 'preset')).not.toHaveProperty('path');
  });
});

describe('dshHome', () => {
  it('prefers DSH_HOME, falls back to HOME/.dsh, and survives with neither', () => {
    const realDsh = process.env['DSH_HOME'];
    const realHome = process.env['HOME'];
    try {
      process.env['DSH_HOME'] = '/dsh';
      expect(dshHome()).toBe('/dsh');
      delete process.env['DSH_HOME'];
      process.env['HOME'] = '/home';
      expect(dshHome()).toBe('/home/.dsh');
      delete process.env['HOME'];
      expect(dshHome()).toBeUndefined();
    } finally {
      if (realDsh === undefined) delete process.env['DSH_HOME'];
      else process.env['DSH_HOME'] = realDsh;
      if (realHome === undefined) delete process.env['HOME'];
      else process.env['HOME'] = realHome;
    }
  });
});

describe('buildPayload MCP source with preset', () => {
  it('resolves the preset name when agent has a composed preset', async () => {
    const agent = { ctx: {} };
    const agents = { get: () => agent };
    const skills = {
      list: () => [],
    };
    const tools = {
      schemas() { return []; },
    };
    const agentPresets = {
      composedPreset: () => 'my-preset',
      list: () => [{ id: 'my-preset', trust: 'user' as const, path: '/tmp', name: 'My Preset' }],
    };
    const services = {
      get(name: string) {
        if (name === 'agents') return agents;
        if (name === 'skills') return skills;
        if (name === 'tools') return tools;
        if (name === 'agentPresets') return agentPresets;
        return undefined;
      },
    };
    const payload = await buildPayload(services as never, 's1', EMPTY_STATE);
    expect(payload.sessionId).toBe('s1');
  });

  it('falls back to preset id when preset name is unavailable', async () => {
    const agent = { ctx: {} };
    const agents = { get: () => agent };
    const skills = {
      list: () => [],
    };
    const tools = {
      schemas() { return []; },
    };
    const agentPresets = {
      composedPreset: () => 'my-preset',
      list: () => [],
    };
    const services = {
      get(name: string) {
        if (name === 'agents') return agents;
        if (name === 'skills') return skills;
        if (name === 'tools') return tools;
        if (name === 'agentPresets') return agentPresets;
        return undefined;
      },
    };
    const payload = await buildPayload(services as never, 's1', EMPTY_STATE);
    expect(payload.sessionId).toBe('s1');
  });

  it('handles a failing preset list gracefully', async () => {
    const agent = { ctx: {} };
    const agents = { get: () => agent };
    const skills = {
      list: () => [],
    };
    const tools = {
      schemas() { return []; },
    };
    const agentPresets = {
      composedPreset: () => 'my-preset',
      list: () => { throw new Error('boom'); },
    };
    const services = {
      get(name: string) {
        if (name === 'agents') return agents;
        if (name === 'skills') return skills;
        if (name === 'tools') return tools;
        if (name === 'agentPresets') return agentPresets;
        return undefined;
      },
    };
    const payload = await buildPayload(services as never, 's1', EMPTY_STATE);
    expect(payload.sessionId).toBe('s1');
  });

  it('falls back to "unknown" when skill source or provider is not a string', async () => {
    const agent = { ctx: {} };
    const agents = { get: () => agent };
    const skills = {
      list: () => [
        { name: 'odd-skill', description: '', source: 42, provider: null, invocation: { modelInvocable: true, userInvocable: true } },
      ],
    };
    const tools = {
      schemas() { return []; },
    };
    const services = {
      get(name: string) {
        if (name === 'agents') return agents;
        if (name === 'skills') return skills;
        if (name === 'tools') return tools;
        return undefined;
      },
    };
    const payload = await buildPayload(services as never, 's1', EMPTY_STATE);
    expect(payload.skills[0]?.source).toBe('unknown');
    expect(payload.skills[0]?.provider).toBe('unknown');
  });

  it('carries the resourceBase directory path into the skill entry', async () => {
    const agent = { ctx: {} };
    const agents = { get: () => agent };
    const skills = {
      list: () => [
        { name: 'fs-skill', description: '', source: 'custom', provider: 'filesystem', resourceBase: { kind: 'directory', path: '/skills/custom' }, invocation: { modelInvocable: true, userInvocable: true } },
        { name: 'url-skill', description: '', source: 'runtime', provider: 'plugin', resourceBase: { kind: 'url', url: 'https://x' }, invocation: { modelInvocable: true, userInvocable: true } },
        { name: 'empty-path', description: '', source: 'runtime', provider: 'plugin', resourceBase: { kind: 'directory', path: '' }, invocation: { modelInvocable: true, userInvocable: true } },
        { name: 'no-base', description: '', source: 'runtime', provider: 'plugin', invocation: { modelInvocable: true, userInvocable: true } },
      ],
    };
    const tools = {
      schemas() { return []; },
    };
    const services = {
      get(name: string) {
        if (name === 'agents') return agents;
        if (name === 'skills') return skills;
        if (name === 'tools') return tools;
        return undefined;
      },
    };
    const payload = await buildPayload(services as never, 's1', EMPTY_STATE);
    expect(payload.skills.find((s) => s.name === 'fs-skill')?.path).toBe('/skills');
    expect(payload.skills.find((s) => s.name === 'url-skill')).not.toHaveProperty('path');
    expect(payload.skills.find((s) => s.name === 'empty-path')).not.toHaveProperty('path');
    expect(payload.skills.find((s) => s.name === 'no-base')).not.toHaveProperty('path');
  });

  it('groups custom skills discovered under a preset directory as that preset', async () => {
    const agent = { ctx: {} };
    const agents = { get: () => agent };
    const skills = {
      list: () => [
        { name: 'preset-skill', description: '', source: 'custom', provider: 'filesystem', resourceBase: { kind: 'directory', path: '/presets/cordis/skills/preset-skill' }, invocation: { modelInvocable: true, userInvocable: true } },
        { name: 'preset-root', description: '', source: 'custom', provider: 'filesystem', resourceBase: { kind: 'directory', path: '/presets/cordis/x' }, invocation: { modelInvocable: true, userInvocable: true } },
        { name: 'plain-custom', description: '', source: 'custom', provider: 'filesystem', resourceBase: { kind: 'directory', path: '/elsewhere/skills/plain-custom' }, invocation: { modelInvocable: true, userInvocable: true } },
        { name: 'presetless-dir', description: '', source: 'user-dsh', provider: 'filesystem', resourceBase: { kind: 'directory', path: '/presets/cordis/skills/presetless-dir' }, invocation: { modelInvocable: true, userInvocable: true } },
      ],
    };
    const tools = {
      schemas() { return []; },
    };
    const agentPresets = {
      composedPreset: () => 'cordis',
      list: () => [
        { id: 'cordis', trust: 'system' as const, path: '/presets/cordis', name: 'Cordis' },
        { id: 'no-path', trust: 'user' as const },
        { id: 'empty-path', trust: 'user' as const, path: '' },
        { id: 'no-name', trust: 'user' as const, path: '/presets/noname' },
      ],
    };
    const services = {
      get(name: string) {
        if (name === 'agents') return agents;
        if (name === 'skills') return skills;
        if (name === 'tools') return tools;
        if (name === 'agentPresets') return agentPresets;
        return undefined;
      },
    };
    const payload = await buildPayload(services as never, 's1', EMPTY_STATE);
    // Under the preset's directory (nested or direct child) → the preset group.
    expect(payload.skills.find((s) => s.name === 'preset-skill')?.group).toBe('preset:Cordis');
    expect(payload.skills.find((s) => s.name === 'preset-root')?.group).toBe('preset:Cordis');
    // A custom dir outside every preset keeps the plain custom grouping.
    expect(payload.skills.find((s) => s.name === 'plain-custom')).not.toHaveProperty('group');
    // Only custom sources are re-grouped; real user-dsh keeps its own category.
    expect(payload.skills.find((s) => s.name === 'presetless-dir')).not.toHaveProperty('group');
  });

  it('keeps the original provenance when a panel shadow lists before the original', async () => {
    const agent = { ctx: {} };
    const agents = { get: () => agent };
    const skills = {
      list: () => [
        // The shadow the panel registered: wins the same-name listing but
        // carries no meaningful provenance of its own.
        { name: 'lark-base', description: '', source: 'custom', provider: 'capability-panel', invocation: { modelInvocable: false, userInvocable: true } },
        { name: 'lark-base', description: 'original', source: 'user-agents', provider: 'filesystem', resourceBase: { kind: 'directory', path: '/agents/skills' }, invocation: { modelInvocable: true, userInvocable: true } },
        // Same swap, but the original carries no directory — nothing to copy.
        { name: 'lark-doc', description: '', source: 'custom', provider: 'capability-panel', invocation: { modelInvocable: false, userInvocable: true } },
        { name: 'lark-doc', description: 'original', source: 'user-agents', provider: 'filesystem', invocation: { modelInvocable: true, userInvocable: true } },
        // Same swap again, but the original sits under a preset's directory:
        // the preset group must follow the swap too.
        { name: 'preset-skill', description: '', source: 'custom', provider: 'capability-panel', invocation: { modelInvocable: false, userInvocable: true } },
        { name: 'preset-skill', description: 'original', source: 'custom', provider: 'filesystem', resourceBase: { kind: 'directory', path: '/presets/cordis/skills/preset-skill' }, invocation: { modelInvocable: true, userInvocable: true } },
      ],
    };
    const tools = {
      schemas() { return []; },
    };
    const agentPresets = {
      composedPreset: () => 'cordis',
      list: () => [{ id: 'cordis', trust: 'system' as const, path: '/presets/cordis', name: 'Cordis' }],
    };
    const services = {
      get(name: string) {
        if (name === 'agents') return agents;
        if (name === 'skills') return skills;
        if (name === 'tools') return tools;
        if (name === 'agentPresets') return agentPresets;
        return undefined;
      },
    };
    const payload = await buildPayload(services as never, 's1', EMPTY_STATE);
    const skill = payload.skills.find((s) => s.name === 'lark-base');
    expect(skill?.source).toBe('user-agents');
    expect(skill?.provider).toBe('filesystem');
    expect(skill?.path).toBe('/agents');
    expect(skill?.enabled).toBe(false);
    const noPath = payload.skills.find((s) => s.name === 'lark-doc');
    expect(noPath?.source).toBe('user-agents');
    expect(noPath).not.toHaveProperty('path');
    const presetSkill = payload.skills.find((s) => s.name === 'preset-skill');
    expect(presetSkill?.source).toBe('custom');
    expect(presetSkill?.group).toBe('preset:Cordis');
  });
});
