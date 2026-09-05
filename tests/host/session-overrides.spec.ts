/**
 * Session-bound override persistence: positions write under
 * sessions[sessionId], preset keys pass through untouched, the recency cap
 * evicts oldest-first, and an unreadable settings service degrades to
 * "no overrides" rather than failing a session over a preference.
 */
import { describe, expect, it, vi } from 'vitest';
import { createSessionOverrideStore, MAX_SESSION_RECORDS } from '../../src/host/session-overrides.js';
import { createToolkitSettingsAccess } from '../../src/host/settings-scope.js';
import { HttpError } from '../../src/host/errors.js';
import type { ToolkitSettings } from '../../src/host/types.js';

interface Stored {
  presets: Record<string, string[]>;
  presetSkills: Record<string, string[]>;
  sessions: Record<string, unknown>;
}

function fixture(options: { noSettings?: boolean; getThrows?: boolean; stored?: Partial<Stored> } = {}) {
  const values: Stored = {
    presets: { alpha: ['bash'] },
    presetSkills: {},
    sessions: {},
    ...options.stored,
  };
  const replace = vi.fn((section: Stored) => {
    Object.assign(values, section);
    return Promise.resolve();
  });
  const services: Record<string, unknown> = {};
  if (options.noSettings !== true) {
    services['settings'] = {
      writable: true,
      register: () => ({
        get: () => {
          if (options.getThrows === true) throw new Error('stored section is corrupt');
          return values as ToolkitSettings;
        },
        replace,
      }),
    };
  }
  const ctx = { get: (name: string) => services[name] };
  const access = createToolkitSettingsAccess(ctx as never);
  return { store: createSessionOverrideStore(access), access, values, replace };
}

describe('record', () => {
  it('writes the position under the session and kind, preserving preset keys', async () => {
    const { store, values, replace } = fixture();

    await store.record('s1', 'skill', 'find-skills', false);

    expect(values.sessions).toEqual({
      s1: { skills: { 'find-skills': false }, mcpServers: {}, mcpTools: {}, systemTools: {} },
    });
    // The preset writer's keys pass through untouched — this namespace has
    // two writers and neither may clobber the other.
    expect(replace).toHaveBeenCalledWith(expect.objectContaining({ presets: { alpha: ['bash'] } }));
  });

  it('records an explicit re-enable (true) so a preset default can be overridden after restart', async () => {
    const { store, values } = fixture();

    await store.record('s1', 'system-tool', 'bash', false);
    await store.record('s1', 'system-tool', 'bash', true);

    expect(values.sessions['s1']).toMatchObject({ systemTools: { bash: true } });
  });

  it('keeps different sessions in separate records', async () => {
    const { store, values } = fixture();

    await store.record('s1', 'skill', 'a', false);
    await store.record('s2', 'skill', 'b', false);

    expect(values.sessions['s1']).toMatchObject({ skills: { a: false } });
    expect(values.sessions['s2']).toMatchObject({ skills: { b: false } });
  });

  it('evicts the oldest record past the cap, and re-recording refreshes recency', async () => {
    const { store, values } = fixture();

    for (let i = 0; i < MAX_SESSION_RECORDS; i += 1) {
      await store.record(`s${String(i)}`, 'skill', 'x', false);
    }
    expect(Object.keys(values.sessions)).toHaveLength(MAX_SESSION_RECORDS);

    // Touch s0 so it is no longer the oldest, then add one more: s1 goes.
    await store.record('s0', 'skill', 'y', false);
    await store.record('newest', 'skill', 'z', false);

    expect(Object.keys(values.sessions)).toHaveLength(MAX_SESSION_RECORDS);
    expect(values.sessions['s0']).toBeDefined();
    expect(values.sessions['s1']).toBeUndefined();
    expect(values.sessions['newest']).toBeDefined();
  });

  it('rejects when the settings service is absent', async () => {
    const { store } = fixture({ noSettings: true });

    await expect(store.record('s1', 'skill', 'a', false)).rejects.toThrow(HttpError);
  });
});

describe('overridesFor', () => {
  it('returns the session record and only that record', async () => {
    const { store } = fixture();
    await store.record('s1', 'mcp-server', 'search', false);

    expect(store.overridesFor('s1')).toMatchObject({ mcpServers: { search: false } });
    expect(store.overridesFor('s2')).toBeUndefined();
  });

  it('degrades to undefined when the stored section cannot be read', () => {
    const { store } = fixture({ getThrows: true });
    expect(store.overridesFor('s1')).toBeUndefined();
  });

  it('degrades to undefined when the settings service is absent', () => {
    const { store } = fixture({ noSettings: true });
    expect(store.overridesFor('s1')).toBeUndefined();
  });
});
