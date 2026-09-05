import { describe, expect, it, vi } from 'vitest';
import { createPresetToolController, PRESET_SETTINGS_NAMESPACE } from '../../src/host/preset-tools.js';
import { createToolkitSettingsAccess } from '../../src/host/settings-scope.js';
import { HttpError } from '../../src/host/errors.js';

interface FixtureOptions {
  settings?: boolean;
  agentPresets?: boolean;
  tools?: boolean;
  broken?: boolean;
  standingError?: unknown;
  presetMetadata?: boolean;
  skills?: boolean;
  disabledSkills?: string[];
  projectSkill?: boolean;
  skillsListThrows?: boolean;
  settingsRegisterThrows?: boolean;
  storedGetThrows?: boolean;
}

function fixture(options: FixtureOptions = {}) {
  // Both keys carry a schema default, so the settings service always resolves
  // both. Omitting one here would model a section no provider can produce.
  const values: { presets: Record<string, string[]>; presetSkills: Record<string, string[]>; sessions: Record<string, unknown> } = {
    presets: { alpha: ['bash'] },
    presetSkills: options.disabledSkills === undefined ? {} : { alpha: options.disabledSkills },
    sessions: {},
  };
  const update = vi.fn((section: { presets?: Record<string, string[]>; presetSkills?: Record<string, string[]>; sessions?: Record<string, unknown> }) => {
    values.presets = section.presets ?? {};
    values.presetSkills = section.presetSkills ?? {};
    values.sessions = section.sessions ?? {};
    return Promise.resolve();
  });
  const registrations: unknown[][] = [];
  const services: Record<string, unknown> = {};
  if (options.settingsRegisterThrows === true) {
    services['settings'] = {
      writable: true,
      register: () => {
        throw new Error('settings namespace "capability-panel" is already registered');
      },
    };
  } else if (options.settings !== false) {
    services.settings = {
      writable: true,
      register(...args: unknown[]) {
        registrations.push(args);
        return {
          get: () => {
            if (options.storedGetThrows === true) throw new Error('stored section is corrupt');
            return values;
          },
          replace: update,
        };
      },
    };
  }
  if (options.agentPresets !== false) {
    services.agentPresets = {
      list: () => Promise.resolve([{ id: 'alpha', trust: 'system', ...(options.presetMetadata === false ? {} : { name: 'Alpha', description: 'primary' }), ...(options.broken ? { broken: 'bad yaml' } : {}) }]),
      standingKeyFor: () => options.standingError === undefined
        ? Promise.resolve({ preset: 'alpha' })
        : Promise.reject(options.standingError instanceof Error ? options.standingError : new Error('offline')),
    };
  }
  if (options.tools !== false) {
    services.tools = {
      schemas: () => [
        { name: 'run_code' },
        { name: 'bash', description: 'shell' },
        { name: 'bash', description: 'duplicate ignored' },
        { name: 'mcp__search__web', description: 'lookup' },
        { name: 'mcp__search__image' },
        { name: '' },
        { name: 42 },
      ],
    };
  }
  if (options.skills !== false) {
    services.skills = {
      list: (lookup: { cwd?: string }) => options.skillsListThrows === true
        ? Promise.reject(new Error('no reader'))
        : Promise.resolve(
        lookup.cwd !== undefined && options.projectSkill === true
          ? [{ name: 'writing', description: 'house style' }, { name: 'local-only' }]
          : [{ name: 'writing', description: 'house style' }],
      ),
    };
  }
  const ctx = {
    get: (name: string) => services[name],
  };
  return {
    controller: createPresetToolController(ctx as never, createToolkitSettingsAccess(ctx as never)),
    values,
    update,
    registrations,
  };
}

function expectHttp(error: unknown, status: number, message: string): void {
  expect(error).toBeInstanceOf(HttpError);
  expect(error).toMatchObject({ status, message });
}

describe('preset tool settings', () => {
  it('registers a live settings namespace and lists complete preset tools', async () => {
    const host = fixture();
    // Registration is deferred to first use, so nothing is registered yet.
    expect(host.registrations).toHaveLength(0);
    const listed = host.controller.list();
    expect(host.registrations[0]?.[0]).toBe(PRESET_SETTINGS_NAMESPACE);
    expect(host.registrations[0]?.[2]).toEqual({ applies: 'live' });
    await expect(listed).resolves.toEqual({
      writable: true,
      presets: [{
        id: 'alpha',
        name: 'Alpha',
        description: 'primary',
        trust: 'system',
        skills: [{ name: 'writing', description: 'house style', enabled: true }],
        mcp: [{
          server: 'search',
          enabled: true,
          tools: [
            { name: 'mcp__search__image', label: 'image', enabled: true },
            { name: 'mcp__search__web', label: 'web', description: 'lookup', enabled: true },
          ],
        }],
        systemTools: [
          { name: 'bash', label: 'bash', description: 'shell', enabled: false },
          { name: 'run_code', label: 'run_code', enabled: true, reserved: true },
        ],
      }],
    });
  });

  it('persists disable and enable changes without touching running agents', async () => {
    const host = fixture();
    await host.controller.set('alpha', 'run_code', true);
    expect(host.update).toHaveBeenLastCalledWith({ presets: { alpha: ['bash'] }, presetSkills: {}, sessions: {} });
    await host.controller.set('alpha', 'bash', true);
    // Re-enabling the last disabled tool must REMOVE the preset key, which a
    // merge patch cannot express: the section is written wholesale.
    expect(host.update).toHaveBeenLastCalledWith({ presets: {}, presetSkills: {}, sessions: {} });
    expect(host.values.presets).toEqual({});
    await host.controller.set('alpha', 'bash', false);
    expect(host.values.presets).toEqual({ alpha: ['bash'] });
  });

  it('toggles a whole MCP server in one write', async () => {
    const host = fixture();
    // 200 MCP tools behind two servers is the case this exists for: one write,
    // not one request per tool.
    await host.controller.setServer('alpha', 'search', false);
    expect(host.update).toHaveBeenLastCalledWith({
      presets: { alpha: ['bash', 'mcp__search__image', 'mcp__search__web'] },
      presetSkills: {},
      sessions: {},
    });
    // Starting from an empty stored set exercises the other side of `?? []`.
    const fresh = fixture();
    fresh.values.presets = {};
    await fresh.controller.setServer('alpha', 'search', false);
    expect(fresh.update).toHaveBeenLastCalledWith({
      presets: { alpha: ['mcp__search__image', 'mcp__search__web'] },
      presetSkills: {},
      sessions: {},
    });
    const payload = await host.controller.setServer('alpha', 'search', true);
    expect(host.update).toHaveBeenLastCalledWith({ presets: { alpha: ['bash'] }, presetSkills: {}, sessions: {} });
    expect(payload.presets[0]?.mcp[0]).toMatchObject({ server: 'search', enabled: true });
  });

  it('reports a server the preset does not expose', async () => {
    const host = fixture();
    await expect(host.controller.setServer('alpha', 'ghost', false)).rejects.toMatchObject({
      status: 404,
      message: 'MCP server "ghost" is not available in preset "alpha"',
    });
  });

  it('marks a server disabled only when every one of its tools is off', async () => {
    const host = fixture();
    await host.controller.set('alpha', 'mcp__search__web', false);
    const partly = await host.controller.list();
    expect(partly.presets[0]?.mcp[0]?.enabled).toBe(true);
    const all = await host.controller.setServer('alpha', 'search', false);
    expect(all.presets[0]?.mcp[0]?.enabled).toBe(false);
  });

  it('registers the namespace only once across repeated reads and writes', async () => {
    const host = fixture();
    await host.controller.list();
    await host.controller.set('alpha', 'bash', true);
    expect(host.registrations).toHaveLength(1);
  });

  it('omits optional preset metadata', async () => {
    await expect(fixture({ presetMetadata: false }).controller.list()).resolves.toEqual({
      writable: true,
      presets: [{
        id: 'alpha',
        name: 'alpha',
        trust: 'system',
        skills: [{ name: 'writing', description: 'house style', enabled: true }],
        mcp: [{
          server: 'search',
          enabled: true,
          tools: [
            { name: 'mcp__search__image', label: 'image', enabled: true },
            { name: 'mcp__search__web', label: 'web', description: 'lookup', enabled: true },
          ],
        }],
        systemTools: [
          { name: 'bash', label: 'bash', description: 'shell', enabled: false },
          { name: 'run_code', label: 'run_code', enabled: true, reserved: true },
        ],
      }],
    });
  });

  it('lists broken presets without trying to mount them', async () => {
    const host = fixture({ broken: true, standingError: new Error('must not mount') });
    await expect(host.controller.list()).resolves.toEqual({
      writable: true,
      presets: [{ id: 'alpha', name: 'Alpha', description: 'primary', trust: 'system', broken: 'bad yaml', skills: [], mcp: [], systemTools: [] }],
    });
  });

  it('classifies missing services, invalid ids/tools, reserved tools and mount failures', async () => {
    const cases: [Promise<unknown>, number, string][] = [
      [fixture({ settings: false }).controller.list(), 503, 'settings service unavailable'],
      [fixture({ agentPresets: false }).controller.list(), 503, 'agentPresets service unavailable'],
      [fixture({ tools: false }).controller.list(), 503, 'tools service unavailable'],
      [fixture().controller.set('missing', 'bash', false), 404, 'preset "missing" is not available'],
      [fixture().controller.set('alpha', 'missing', false), 404, 'tool "missing" is not available in preset "alpha"'],
      [fixture().controller.set('alpha', 'run_code', false), 409, 'run_code is the reserved Code Mode transport and cannot be restricted'],
      [fixture({ broken: true }).controller.set('alpha', 'bash', false), 409, 'preset "alpha" is broken: bad yaml'],
      [fixture({ standingError: new Error('offline') }).controller.list(), 503, 'preset "alpha" tools are unavailable: offline'],
      [fixture({ standingError: new Error('offline') }).controller.set('alpha', 'bash', false), 503, 'preset "alpha" tools are unavailable: offline'],
    ];
    for (const [pending, status, message] of cases) {
      try {
        await pending;
        throw new Error('expected rejection');
      } catch (error: unknown) {
        expectHttp(error, status, message);
      }
    }
  });
  it('lists project skills marked, and reflects the stored disabled set', async () => {
    const host = fixture({ projectSkill: true, disabledSkills: ['writing'] });
    const payload = await host.controller.list();
    // The cwd-only entry is marked, not hidden: it is real for this workspace
    // and absent elsewhere, and a short list could not say that.
    expect(payload.presets[0]?.skills).toEqual([
      { name: 'local-only', enabled: true, project: true },
      { name: 'writing', description: 'house style', enabled: false },
    ]);
  });

  it('persists a skill toggle in its own map, leaving tool names untouched', async () => {
    const host = fixture();
    await host.controller.setSkill('alpha', 'writing', false);
    expect(host.update).toHaveBeenLastCalledWith({
      presets: { alpha: ['bash'] },
      presetSkills: { alpha: ['writing'] },
      sessions: {},
    });
    await host.controller.setSkill('alpha', 'writing', true);
    expect(host.update).toHaveBeenLastCalledWith({ presets: { alpha: ['bash'] }, presetSkills: {}, sessions: {} });
  });

  it('refuses a skill toggle the preset cannot see, and one it cannot mount', async () => {
    await expect(fixture().controller.setSkill('alpha', 'ghost', false))
      .rejects.toSatisfy((error) => { expectHttp(error, 404, 'skill "ghost" is not available in preset "alpha"'); return true; });
    await expect(fixture({ broken: true }).controller.setSkill('alpha', 'writing', false))
      .rejects.toSatisfy((error) => { expectHttp(error, 409, 'preset "alpha" is broken: bad yaml'); return true; });
    await expect(fixture().controller.setSkill('ghost', 'writing', false))
      .rejects.toSatisfy((error) => { expectHttp(error, 404, 'preset "ghost" is not available'); return true; });
    await expect(fixture({ skills: false }).controller.setSkill('alpha', 'writing', false))
      .rejects.toSatisfy((error) => { expectHttp(error, 503, 'skills service unavailable'); return true; });
    await expect(fixture({ standingError: true }).controller.setSkill('alpha', 'writing', false))
      .rejects.toSatisfy((error) => { expectHttp(error, 503, 'preset "alpha" skills are unavailable: offline'); return true; });
  });

  it('reports a preset whose skills cannot be read instead of listing it as empty', async () => {
    const failing = fixture({ skillsListThrows: true });
    await expect(failing.controller.list())
      .rejects.toSatisfy((error) => { expectHttp(error, 503, 'preset "alpha" skills are unavailable: no reader'); return true; });
  });

  it('omits skills entirely when the service is absent', async () => {
    const payload = await fixture({ skills: false }).controller.list();
    expect(payload.presets[0]?.skills).toEqual([]);
  });

  describe('defaultsFor', () => {
    it('returns the stored defaults for a preset, reserved transport filtered', () => {
      const host = fixture();
      host.values.presets = { alpha: ['bash', 'run_code'] };
      host.values.presetSkills = { alpha: ['writing'] };

      expect(host.controller.defaultsFor('alpha')).toEqual({ tools: ['bash'], skills: ['writing'] });
    });

    it('reads a preset with nothing stored as empty lists', () => {
      const host = fixture();
      expect(host.controller.defaultsFor('nobody')).toEqual({ tools: [], skills: [] });
      // The fixture stores one tool default for alpha; skills are empty.
      expect(host.controller.defaultsFor('alpha')).toEqual({ tools: ['bash'], skills: [] });
    });

    // Enforcement runs at agent/created, where a throw can veto the session:
    // a settings service that is absent, refuses registration, or holds a
    // corrupt section must read as "no defaults", never as an exception.
    it.each([
      ['absent', { settings: false }],
      ['refusing registration', { settingsRegisterThrows: true }],
      ['holding a corrupt section', { storedGetThrows: true }],
    ])('returns undefined when settings are %s', (_label, options) => {
      expect(fixture(options).controller.defaultsFor('alpha')).toBeUndefined();
    });
  });

  // Read-modify-write over one namespace: two toggles that interleave must not
  // each persist a section computed from the same pre-read snapshot.
  it('does not lose a toggle when two writes overlap', async () => {
    const host = fixture();
    // One write per registry, started together: each reads the stored section
    // before either has written it, so an unserialized pair would persist two
    // sections computed from the same snapshot and the later would drop the
    // other's registry wholesale.
    await Promise.all([
      host.controller.setSkill('alpha', 'writing', false),
      host.controller.set('alpha', 'mcp__search__web', false),
    ]);
    expect(host.values.presets['alpha']).toEqual(['bash', 'mcp__search__web']);
    expect(host.values.presetSkills?.['alpha']).toEqual(['writing']);
  });

  // A rejected write must not wedge the queue: the next toggle still has to run.
  it('keeps serializing writes after one of them fails', async () => {
    const host = fixture();
    host.update.mockRejectedValueOnce(new Error('settings file is read-only'));
    await expect(host.controller.setSkill('alpha', 'writing', false)).rejects.toThrow('read-only');
    await host.controller.set('alpha', 'mcp__search__web', false);
    expect(host.values.presets['alpha']).toEqual(['bash', 'mcp__search__web']);
  });

  // The enforcement listener drops the reserved transport from the deny list
  // unconditionally, so a stale entry naming it must not render a switch that
  // claims it is off -- that switch is locked, so the user could never clear it.
  it('reports the reserved transport as enabled even when a stale entry disables it', async () => {
    const host = fixture();
    host.values.presets = { alpha: ['run_code'] };
    const payload = await host.controller.list();
    const row = payload.presets[0]?.systemTools.find((tool) => tool.name === 'run_code');
    expect(row).toMatchObject({ reserved: true, enabled: true });
  });
});
