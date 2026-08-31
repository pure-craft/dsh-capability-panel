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
}

function fixture(options: FixtureOptions = {}) {
  const values = { presets: { alpha: ['bash'] } };
  const update = vi.fn((section: { presets?: Record<string, string[]> }) => {
    values.presets = (section.presets ?? {}) as { alpha: string[] };
    return Promise.resolve();
  });
  const restrict = vi.fn(() => {
    if (options.restrictThrows === true) throw new Error('unknown global tool');
    return vi.fn();
  });
  const registrations: unknown[][] = [];
  let created: ((payload: { agent: { ctx: { get(name: string): unknown } } }) => void) | undefined;
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
  const ctx = {
    get: (name: string) => services[name],
    on(event: string, listener: typeof created) {
      if (event === 'agent/created') created = listener;
    },
  };
  return { controller: createPresetToolController(ctx as never), values, update, restrict, registrations, emitCreated() {
    created?.({ agent: { ctx: { get: (name) => name === 'tools' && options.scopedTools !== false ? { restrict } : undefined } } });
  } };
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
    expect(host.update).toHaveBeenLastCalledWith({ presets: { alpha: ['bash'] } });
    await host.controller.set('alpha', 'bash', true);
    // Re-enabling the last disabled tool must REMOVE the preset key, which a
    // merge patch cannot express: the section is written wholesale.
    expect(host.update).toHaveBeenLastCalledWith({ presets: {} });
    expect(host.values.presets).toEqual({});
    await host.controller.set('alpha', 'bash', false);
    expect(host.values.presets).toEqual({ alpha: ['bash'] });
  });

  it('restricts only newly created or restored agents using their composed preset', () => {
    const host = fixture();
    host.emitCreated();
    expect(host.restrict).toHaveBeenCalledWith({ deny: ['bash'] });
  });

  it('toggles a whole MCP server in one write', async () => {
    const host = fixture();
    // 200 MCP tools behind two servers is the case this exists for: one write,
    // not one request per tool.
    await host.controller.setServer('alpha', 'search', false);
    expect(host.update).toHaveBeenLastCalledWith({
      presets: { alpha: ['bash', 'mcp__search__image', 'mcp__search__web'] },
    });
    // Starting from an empty stored set exercises the other side of `?? []`.
    const fresh = fixture();
    fresh.values.presets = {} as { alpha: string[] };
    await fresh.controller.setServer('alpha', 'search', false);
    expect(fresh.update).toHaveBeenLastCalledWith({
      presets: { alpha: ['mcp__search__image', 'mcp__search__web'] },
    });
    const payload = await host.controller.setServer('alpha', 'search', true);
    expect(host.update).toHaveBeenLastCalledWith({ presets: { alpha: ['bash'] } });
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
    host.emitCreated();
    expect(host.registrations).toHaveLength(1);
  });

  it('drops stored names the agent cannot see and survives a refused mask', () => {
    const stale = fixture();
    stale.values.presets = { alpha: ['bash', 'removed-by-a-plugin-uninstall'] };
    stale.emitCreated();
    expect(stale.restrict).toHaveBeenCalledWith({ deny: ['bash'] });

    const vanished = fixture();
    vanished.values.presets = { alpha: ['removed-by-a-plugin-uninstall'] };
    vanished.emitCreated();
    expect(vanished.restrict).not.toHaveBeenCalled();

    const refused = fixture({ restrictThrows: true });
    expect(() => { refused.emitCreated(); }).not.toThrow();
  });

  it('does not restrict when settings, preset identity, disabled names, or scoped tools are absent', () => {
    const absent = fixture({ settings: false });
    absent.emitCreated();
    expect(absent.restrict).not.toHaveBeenCalled();

    for (const candidate of [
      fixture({ agentPresets: false }),
      fixture({ presetIdentity: '' }),
      fixture({ scopedTools: false }),
    ]) {
      candidate.emitCreated();
      expect(candidate.restrict).not.toHaveBeenCalled();
    }

    const host = fixture();
    host.values.presets = {} as never;
    host.emitCreated();
    expect(host.restrict).not.toHaveBeenCalled();
  });

  it('omits optional preset metadata', async () => {
    await expect(fixture({ presetMetadata: false }).controller.list()).resolves.toEqual({
      writable: true,
      presets: [{
        id: 'alpha',
        name: 'alpha',
        trust: 'system',
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
      presets: [{ id: 'alpha', name: 'Alpha', description: 'primary', trust: 'system', broken: 'bad yaml', mcp: [], systemTools: [] }],
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
});
