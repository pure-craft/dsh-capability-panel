import { describe, expect, it, vi } from 'vitest';
import { createPresetToolController, PRESET_SETTINGS_NAMESPACE } from '../../src/host/preset-tools.js';
import { HttpError } from '../../src/host/errors.js';

interface FixtureOptions {
  settings?: boolean;
  agentPresets?: boolean;
  tools?: boolean;
  broken?: boolean;
  standingError?: unknown;
  presetIdentity?: string;
  scopedTools?: boolean;
  presetMetadata?: boolean;
  restrictThrows?: boolean;
  skills?: boolean;
  disabledSkills?: string[];
  skillGet?: unknown;
  scopedSkills?: boolean;
  projectSkill?: boolean;
  skillsListThrows?: boolean;
  skillGetThrows?: boolean;
  skillGetUndefined?: boolean;
  agentCwd?: boolean;
}

function fixture(options: FixtureOptions = {}) {
  const values: { presets: Record<string, string[]>; presetSkills?: Record<string, string[]> } = {
    presets: { alpha: ['bash'] },
    ...(options.disabledSkills === undefined ? {} : { presetSkills: { alpha: options.disabledSkills } }),
  };
  const update = vi.fn((section: { presets?: Record<string, string[]>; presetSkills?: Record<string, string[]> }) => {
    values.presets = section.presets ?? {};
    values.presetSkills = section.presetSkills ?? {};
    return Promise.resolve();
  });
  const registerSkill = vi.fn(() => vi.fn());
  const restrict = vi.fn(() => {
    if (options.restrictThrows === true) throw new Error('unknown global tool');
    return vi.fn();
  });
  const registrations: unknown[][] = [];
  // Both the tool mask and the skill mask listen on `agent/created`; keeping
  // only the last would silently drop one of them.
  const createdListeners: ((payload: { agent: unknown }) => unknown)[] = [];
  const services: Record<string, unknown> = {};
  if (options.settings !== false) {
    services.settings = {
      writable: true,
      register(...args: unknown[]) {
        registrations.push(args);
        return { get: () => values, replace: update };
      },
    };
  }
  if (options.agentPresets !== false) {
    services.agentPresets = {
      list: () => Promise.resolve([{ id: 'alpha', trust: 'system', ...(options.presetMetadata === false ? {} : { name: 'Alpha', description: 'primary' }), ...(options.broken ? { broken: 'bad yaml' } : {}) }]),
      standingKeyFor: () => options.standingError === undefined
        ? Promise.resolve({ preset: 'alpha' })
        : Promise.reject(options.standingError instanceof Error ? options.standingError : new Error('offline')),
      composedPreset: () => options.presetIdentity === undefined ? 'alpha' : (options.presetIdentity || undefined),
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
      get: () => options.skillGetThrows === true
        ? Promise.reject(new Error('unreadable'))
        : Promise.resolve(
          options.skillGetUndefined === true
            ? undefined
            : options.skillGet === undefined
              ? { name: 'writing', description: 'house style', content: 'body' }
              : options.skillGet,
        ),
    };
  }
  const ctx = {
    get: (name: string) => services[name],
    on(event: string, listener: (payload: { agent: unknown }) => unknown) {
      if (event === 'agent/created') createdListeners.push(listener);
    },
  };
  const scopedGet = (name: string): unknown => {
    if (name === 'tools') return options.scopedTools === false ? undefined : { restrict };
    if (name === 'skills') return options.scopedSkills === false ? undefined : { register: registerSkill };
    return undefined;
  };
  return {
    controller: createPresetToolController(ctx as never),
    values,
    update,
    restrict,
    registerSkill,
    registrations,
    emitCreated() {
      const agent = {
        ctx: { get: scopedGet },
        ...(options.agentCwd === false ? {} : { session: { header: { cwd: '/w' } } }),
      };
      return Promise.all(createdListeners.map((listener) => listener({ agent })));
    },
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
    expect(host.update).toHaveBeenLastCalledWith({ presets: { alpha: ['bash'] }, presetSkills: {} });
    await host.controller.set('alpha', 'bash', true);
    // Re-enabling the last disabled tool must REMOVE the preset key, which a
    // merge patch cannot express: the section is written wholesale.
    expect(host.update).toHaveBeenLastCalledWith({ presets: {}, presetSkills: {} });
    expect(host.values.presets).toEqual({});
    await host.controller.set('alpha', 'bash', false);
    expect(host.values.presets).toEqual({ alpha: ['bash'] });
  });

  it('restricts only newly created or restored agents using their composed preset', async () => {
    const host = fixture();
    await host.emitCreated();
    expect(host.restrict).toHaveBeenCalledWith({ deny: ['bash'] });
  });

  it('toggles a whole MCP server in one write', async () => {
    const host = fixture();
    // 200 MCP tools behind two servers is the case this exists for: one write,
    // not one request per tool.
    await host.controller.setServer('alpha', 'search', false);
    expect(host.update).toHaveBeenLastCalledWith({
      presets: { alpha: ['bash', 'mcp__search__image', 'mcp__search__web'] },
      presetSkills: {},
    });
    // Starting from an empty stored set exercises the other side of `?? []`.
    const fresh = fixture();
    fresh.values.presets = {};
    await fresh.controller.setServer('alpha', 'search', false);
    expect(fresh.update).toHaveBeenLastCalledWith({
      presets: { alpha: ['mcp__search__image', 'mcp__search__web'] },
      presetSkills: {},
    });
    const payload = await host.controller.setServer('alpha', 'search', true);
    expect(host.update).toHaveBeenLastCalledWith({ presets: { alpha: ['bash'] }, presetSkills: {} });
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
    await host.emitCreated();
    expect(host.registrations).toHaveLength(1);
  });

  it('drops stored names the agent cannot see and survives a refused mask', async () => {
    const stale = fixture();
    stale.values.presets = { alpha: ['bash', 'removed-by-a-plugin-uninstall'] };
    await stale.emitCreated();
    expect(stale.restrict).toHaveBeenCalledWith({ deny: ['bash'] });

    const vanished = fixture();
    vanished.values.presets = { alpha: ['removed-by-a-plugin-uninstall'] };
    await vanished.emitCreated();
    expect(vanished.restrict).not.toHaveBeenCalled();

    // A refused mask must not veto the agent; the tool listener is synchronous,
    // so this stays a synchronous expectation.
    const refused = fixture({ restrictThrows: true });
    await expect(refused.emitCreated()).resolves.toBeDefined();
  });

  it('does not restrict when settings, preset identity, disabled names, or scoped tools are absent', async () => {
    const absent = fixture({ settings: false });
    await absent.emitCreated();
    expect(absent.restrict).not.toHaveBeenCalled();

    for (const candidate of [
      fixture({ agentPresets: false }),
      fixture({ presetIdentity: '' }),
      fixture({ scopedTools: false }),
    ]) {
      await candidate.emitCreated();
      expect(candidate.restrict).not.toHaveBeenCalled();
    }

    const host = fixture();
    host.values.presets = {};
    await host.emitCreated();
    expect(host.restrict).not.toHaveBeenCalled();
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
    });
    await host.controller.setSkill('alpha', 'writing', true);
    expect(host.update).toHaveBeenLastCalledWith({ presets: { alpha: ['bash'] }, presetSkills: {} });
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

  it('masks stored skills on agent creation without vetoing the session', async () => {
    const host = fixture({ disabledSkills: ['writing'] });
    await host.emitCreated();
    expect(host.registerSkill).toHaveBeenCalledWith(expect.objectContaining({
      name: 'writing',
      content: 'body',
      invocation: { modelInvocable: false, userInvocable: true },
    }));
  });

  it('carries a resourceBase through the mask when the original has one', async () => {
    const host = fixture({
      disabledSkills: ['writing'],
      skillGet: { name: 'writing', description: 'd', content: 'body', resourceBase: { kind: 'directory', path: '/p' } },
    });
    await host.emitCreated();
    expect(host.registerSkill).toHaveBeenCalledWith(expect.objectContaining({
      resourceBase: { kind: 'directory', path: '/p' },
    }));
  });

  it('skips a skill it cannot read rather than failing agent creation', async () => {
    // Each of these would be a broken mask; none may cost the user a session.
    for (const skillGet of [null, { name: 1 }, { name: 'w', description: 'd' }, { name: 'w', description: 2, content: 'c' }]) {
      const host = fixture({ disabledSkills: ['writing'], skillGet });
      await expect(host.emitCreated()).resolves.toBeDefined();
      expect(host.registerSkill).not.toHaveBeenCalled();
    }
    // `get` resolving undefined is the ordinary "no longer there" case.
    const gone = fixture({ disabledSkills: ['writing'], skillGetUndefined: true });
    await expect(gone.emitCreated()).resolves.toBeDefined();
    expect(gone.registerSkill).not.toHaveBeenCalled();
    const throwing = fixture({ disabledSkills: ['writing'], skillGetThrows: true });
    await expect(throwing.emitCreated()).resolves.toBeDefined();
    expect(throwing.registerSkill).not.toHaveBeenCalled();
  });

  it('does no skill work when there is nothing stored or nowhere to register', async () => {
    const none = fixture();
    await none.emitCreated();
    expect(none.registerSkill).not.toHaveBeenCalled();
    const unscoped = fixture({ disabledSkills: ['writing'], scopedSkills: false });
    await unscoped.emitCreated();
    expect(unscoped.registerSkill).not.toHaveBeenCalled();
    const serviceless = fixture({ disabledSkills: ['writing'], skills: false });
    await serviceless.emitCreated();
    expect(serviceless.registerSkill).not.toHaveBeenCalled();
    const anonymous = fixture({ disabledSkills: ['writing'], presetIdentity: '' });
    await anonymous.emitCreated();
    expect(anonymous.registerSkill).not.toHaveBeenCalled();
    const presetless = fixture({ disabledSkills: ['writing'], agentPresets: false });
    await presetless.emitCreated();
    expect(presetless.registerSkill).not.toHaveBeenCalled();
    const settingless = fixture({ disabledSkills: ['writing'], settings: false });
    await settingless.emitCreated();
    expect(settingless.registerSkill).not.toHaveBeenCalled();
  });

  it('masks a skill for an agent that reports no cwd', async () => {
    const host = fixture({ disabledSkills: ['writing'], agentCwd: false });
    await host.emitCreated();
    expect(host.registerSkill).toHaveBeenCalled();
  });
});
