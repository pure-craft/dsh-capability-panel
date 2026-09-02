/**
 * Preset enforcement, driven through the real capability controller. The
 * listener reads a preset's stored defaults at agent/created and seeds them
 * into the session's own capability state -- which is what makes a preset
 * default a starting point the session can override, rather than a wall.
 */
import { describe, expect, it, vi } from 'vitest';
import { createCapabilityController } from '../../src/host/capabilities.js';
import { registerPresetEnforcement } from '../../src/host/preset-enforcement.js';

interface FixtureOptions {
  defaults?: { tools: string[]; skills: string[] } | undefined;
  presetId?: string | undefined;
  defaultsThrow?: boolean;
  agentId?: unknown;
  noAgent?: boolean;
  noScopedTools?: boolean;
  noScopedSkills?: boolean;
  noSystemPrompt?: boolean;
  skillGetThrows?: boolean;
  skillGetUndefined?: boolean;
  skillGet?: unknown;
  agentCwd?: boolean;
}

function fixture(options: FixtureOptions = {}) {
  const restrictDisposers: ReturnType<typeof vi.fn>[] = [];
  const restrict = vi.fn((filter: { deny: readonly string[] }) => {
    const dispose = vi.fn();
    (dispose as unknown as { denied: readonly string[] }).denied = filter.deny;
    restrictDisposers.push(dispose);
    return dispose;
  });
  const registeredSkills: Record<string, unknown>[] = [];
  const skillDisposers: ReturnType<typeof vi.fn>[] = [];
  const registerSkill = vi.fn((entry: Record<string, unknown>) => {
    registeredSkills.push(entry);
    const dispose = vi.fn();
    skillDisposers.push(dispose);
    return dispose;
  });
  const promptNotes: { name: string; text: () => string }[] = [];
  const noteDispose = vi.fn();

  const agent = {
    id: options.agentId === undefined ? 'session-1' : options.agentId,
    ...(options.agentCwd === false ? {} : { session: { header: { cwd: '/workspace' } } }),
    ctx: {
      get: (name: string): unknown => {
        if (name === 'tools') return options.noScopedTools === true ? undefined : { restrict };
        if (name === 'skills') return options.noScopedSkills === true ? undefined : { register: registerSkill };
        if (name === 'systemPrompt') {
          return options.noSystemPrompt === true
            ? undefined
            : { context: (note: { name: string; text: () => string }) => { promptNotes.push(note); return noteDispose; } };
        }
        return undefined;
      },
    },
  };

  const listeners: ((payload: { agent: unknown }) => unknown)[] = [];
  const teardowns: (() => void)[] = [];
  const ctx = {
    get(name: string): unknown {
      if (name === 'agentPresets') return { composedPreset: () => (options.presetId === undefined && !('presetId' in options) ? 'alpha' : options.presetId) };
      if (name === 'agents') return options.noAgent === true ? undefined : { get: () => agent };
      if (name === 'tools') {
        return {
          schemas: (scope?: unknown) => [
            { name: 'run_code', description: 'transport' },
            { name: 'bash', description: 'shell' },
            { name: 'mcp__search__web', description: 'lookup' },
            // Registry noise the seed must skip, and a tool only the global
            // catalog knows (a preset cannot scope to what an agent lacks).
            { name: 42 },
            ...(scope === undefined ? [{ name: 'global_only', description: 'no agent scope' }] : []),
          ],
          guard: () => () => {},
        };
      }
      if (name === 'skills') {
        return {
          get: () => options.skillGetThrows === true
            ? Promise.reject(new Error('unreadable'))
            : options.skillGetUndefined === true
              ? Promise.resolve(undefined)
              : Promise.resolve(
                  options.skillGet === undefined
                    ? { name: 'writing', description: 'house style', content: 'body', resourceBase: '/r' }
                    : options.skillGet,
                ),
        };
      }
      return undefined;
    },
    on(event: string, listener: (payload: { agent: unknown }) => unknown) {
      if (event === 'agent/created') listeners.push(listener);
    },
    effect(callback: () => (() => void) | void) {
      const dispose = callback();
      if (typeof dispose === 'function') teardowns.push(dispose);
      return () => {};
    },
  };

  const capabilities = createCapabilityController(ctx as never, () => {}, {});
  const presetTools = {
    defaultsFor: () => {
      if (options.defaultsThrow === true) throw new Error('settings gone');
      return options.defaults;
    },
  };

  registerPresetEnforcement(ctx as never, capabilities, presetTools as never);

  return {
    capabilities,
    agent,
    restrict,
    restrictDisposers,
    registerSkill,
    registeredSkills,
    listenerCount: () => listeners.length,
    skillDisposers,
    promptNotes,
    noteDispose,
    async emitCreated() {
      await Promise.all(listeners.map((listener) => listener({ agent })));
    },
    emitCreatedSync() {
      return listeners.map((listener) => listener({ agent }));
    },
    disposeFiber() {
      for (const dispose of teardowns) dispose();
    },
  };
}

const defaults = (tools: string[] = [], skills: string[] = []): { defaults: { tools: string[]; skills: string[] } } => ({ defaults: { tools, skills } });

describe('preset enforcement', () => {
  it('seeds stored tool and skill defaults into the session state', async () => {
    const fx = fixture(defaults(['bash', 'mcp__search__web'], ['writing']));
    await fx.emitCreated();

    const state = fx.capabilities.state('session-1');
    expect([...state!.systemTools.keys()]).toEqual(['bash']);
    expect([...state!.mcpTools.keys()]).toEqual(['mcp__search__web']);
    expect([...state!.skills.keys()]).toEqual(['writing']);
    expect(fx.registeredSkills[0]).toMatchObject({
      name: 'writing',
      invocation: { modelInvocable: false, userInvocable: true },
      resourceBase: '/r',
    });
  });

  // The user's rule: a preset default is the starting point, and the session
  // may override it. Seeding into the session state is what makes the panel's
  // enable switch dispose a mask the preset layer applied.
  it('lets the session switch a preset default back on', async () => {
    const fx = fixture(defaults(['bash'], ['writing']));
    await fx.emitCreated();

    await fx.capabilities.set('session-1', 'system-tool', 'bash', true);
    await fx.capabilities.set('session-1', 'skill', 'writing', true);

    expect(fx.restrictDisposers[0]).toHaveBeenCalled();
    expect(fx.skillDisposers[0]).toHaveBeenCalled();
    expect(fx.capabilities.state('session-1')!.systemTools.size).toBe(0);
    expect(fx.capabilities.state('session-1')!.skills.size).toBe(0);
  });

  it('tells the model about seeded defaults through the prompt note', async () => {
    const fx = fixture(defaults(['bash'], ['writing']));
    await fx.emitCreated();

    expect(fx.promptNotes).toHaveLength(1);
    const text = fx.promptNotes[0]!.text();
    expect(text).toContain('bash');
    expect(text).toContain('writing');
  });

  it('registers the note once even when several defaults land', async () => {
    const fx = fixture(defaults(['bash', 'mcp__search__web'], ['writing']));
    await fx.emitCreated();
    expect(fx.promptNotes).toHaveLength(1);
  });

  it('never throws synchronously, even when the settings read explodes', () => {
    const fx = fixture({ defaultsThrow: true });
    expect(() => fx.emitCreatedSync()).not.toThrow();
  });

  it('does nothing without a preset identity, defaults, or an agent id', async () => {
    for (const fx of [
      fixture({ defaults: { tools: ['bash'], skills: [] }, presetId: undefined }),
      fixture({ defaults: undefined }),
      fixture({ defaults: { tools: [], skills: [] } }),
      fixture({ defaults: { tools: ['bash'], skills: [] }, agentId: 42 }),
    ]) {
      await fx.emitCreated();
      expect(fx.restrict).not.toHaveBeenCalled();
      expect(fx.registerSkill).not.toHaveBeenCalled();
    }
  });

  it('does nothing when the agent cannot be resolved for seeding', async () => {
    const fx = fixture({ ...defaults(['bash'], ['writing']), noAgent: true });
    await fx.emitCreated();
    expect(fx.restrict).not.toHaveBeenCalled();
    expect(fx.registerSkill).not.toHaveBeenCalled();
    expect(fx.capabilities.state('session-1')).toBeUndefined();
  });

  // A stored name can outlive the thing it named; dropping it is the correct
  // behaviour, failing the session over it is not.
  it('drops defaults for names the agent cannot see', async () => {
    const fx = fixture(defaults(['bash', 'removed_tool', 'run_code'], ['writing']));
    await fx.emitCreated();

    const state = fx.capabilities.state('session-1')!;
    expect([...state.systemTools.keys()]).toEqual(['bash']);
    expect(state.systemTools.has('run_code')).toBe(false);
    expect(state.systemTools.has('removed_tool')).toBe(false);
  });

  it('skips the reserved transport even if a stored entry names it', async () => {
    const fx = fixture(defaults(['run_code']));
    await fx.emitCreated();
    expect(fx.capabilities.state('session-1')).toBeUndefined();
  });

  it('leaves a skill alone when it cannot be read or is gone', async () => {
    for (const fx of [fixture({ ...defaults([], ['writing']), skillGetThrows: true }), fixture({ ...defaults([], ['writing']), skillGetUndefined: true })]) {
      await fx.emitCreated();
      expect(fx.registerSkill).not.toHaveBeenCalled();
    }
  });

  it('is idempotent across a session resume firing agent/created again', async () => {
    const fx = fixture(defaults(['bash', 'mcp__search__web'], ['writing']));
    await fx.emitCreated();
    await fx.emitCreated();

    expect(fx.restrictDisposers).toHaveLength(2);
    expect(fx.registeredSkills).toHaveLength(1);
  });

  it('still seeds tools when skills cannot be scoped, and vice versa', async () => {
    const noSkills = fixture({ ...defaults(['bash'], ['writing']), noScopedSkills: true });
    await noSkills.emitCreated();
    expect([...noSkills.capabilities.state('session-1')!.systemTools.keys()]).toEqual(['bash']);
    expect(noSkills.registerSkill).not.toHaveBeenCalled();

    const noTools = fixture({ ...defaults(['bash'], ['writing']), noScopedTools: true });
    await noTools.emitCreated();
    expect([...noTools.capabilities.state('session-1')!.skills.keys()]).toEqual(['writing']);
    expect(noTools.restrict).not.toHaveBeenCalled();
  });

  it('seeds without a prompt note when the agent has no system prompt service', async () => {
    const fx = fixture({ ...defaults(['bash']), noSystemPrompt: true });
    await fx.emitCreated();
    expect(fx.capabilities.state('session-1')!.systemTools.has('bash')).toBe(true);
    expect(fx.promptNotes).toHaveLength(0);
  });

  it('skips registry noise and tools outside the agent scope', async () => {
    const fx = fixture(defaults(['bash', 'global_only']));
    await fx.emitCreated();

    const state = fx.capabilities.state('session-1')!;
    expect([...state.systemTools.keys()]).toEqual(['bash']);
  });

  // A malformed stored record is data rot, not a reason to fail a session.
  it.each([
    ['no name', { description: 'd', content: 'c' }],
    ['no description', { name: 'writing', content: 'c' }],
    ['no content', { name: 'writing', description: 'd' }],
    ['no resourceBase', { name: 'writing', description: 'd', content: 'c' }],
  ])('handles a skill record with %s', async (_label, skillGet) => {
    const fx = fixture({ ...defaults([], ['writing']), skillGet });
    await fx.emitCreated();
    if (_label === 'no resourceBase') {
      expect(fx.registeredSkills[0]).toMatchObject({ name: 'writing' });
      expect(fx.registeredSkills[0]).not.toHaveProperty('resourceBase');
    } else {
      expect(fx.registerSkill).not.toHaveBeenCalled();
    }
  });

  it('seeds skills for an agent that reports no cwd', async () => {
    const fx = fixture({ ...defaults([], ['writing']), agentCwd: false });
    await fx.emitCreated();
    expect(fx.registeredSkills).toHaveLength(1);
  });

  it('releases seeded masks when the fiber goes away', async () => {
    const fx = fixture(defaults(['bash'], ['writing']));
    await fx.emitCreated();
    fx.disposeFiber();

    expect(fx.restrictDisposers[0]).toHaveBeenCalled();
    expect(fx.skillDisposers[0]).toHaveBeenCalled();
    expect(fx.noteDispose).toHaveBeenCalled();
  });

  // One listener covers tools and skills: two subscriptions drifted apart in
  // their failure containment, which is how the synchronous-throw veto got in.
  it('subscribes exactly one agent/created listener', async () => {
    const fx = fixture(defaults(['bash'], ['writing']));
    expect(fx.listenerCount()).toBe(1);
    await fx.emitCreated();
    expect([...fx.capabilities.state('session-1')!.systemTools.keys()]).toEqual(['bash']);
    expect([...fx.capabilities.state('session-1')!.skills.keys()]).toEqual(['writing']);
  });
});
