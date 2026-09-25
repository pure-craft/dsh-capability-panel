import { describe, expect, it, vi } from 'vitest';
import { createToolkitSettingsAccess, TOOLKIT_SETTINGS_NAMESPACE } from '../../src/host/settings-scope.js';

const ctxFor = (settings: unknown, fiber?: unknown) =>
  ({
    get: (name: string) => (name === 'settings' ? settings : undefined),
    ...(fiber === undefined ? {} : { fiber }),
  }) as never;

describe('toolkit settings access', () => {
  describe('namespace resolution', () => {
    // dsh 0.1.7 re-keyed settings namespaces to profile entry ids, so a profile
    // mounting this bundle under a non-default id must be honored — reading the
    // id off this plugin's own fiber is what makes that work.
    it('addresses the namespace by the profile entry id when the loader provides one', async () => {
      const replace = vi.fn(() => Promise.resolve());
      const settings = {
        describe: () => [
          // Foreign entries must be skipped, not mistaken for ours.
          { ns: 'other-entry', value: { presets: { wrong: ['x'] } } },
          { ns: 'custom-entry', value: { presets: { alpha: ['bash'] } } },
        ],
        replace,
      };
      const access = createToolkitSettingsAccess(ctxFor(settings, { entry: { options: { id: 'custom-entry' } } }));
      expect(access.scope()?.get().presets).toEqual({ alpha: ['bash'] });
      await access.scope()?.replace({ presets: {} });
      expect(replace).toHaveBeenCalledWith('custom-entry', { presets: {} });
    });

    // A bare `ctx.plugin` mount has no loader entry, and a malformed entry must
    // not turn into a nonsense namespace: both degrade to the historical literal
    // (which is also what this repo's own bundle patch inserts).
    it.each([
      ['no fiber at all', undefined],
      ['an entry without options', { entry: {} }],
      ['a non-string id', { entry: { options: { id: 7 } } }],
      ['an empty id', { entry: { options: { id: '' } } }],
    ])('falls back to the literal namespace with %s', (_label, fiber) => {
      const settings = {
        describe: () => [{ ns: TOOLKIT_SETTINGS_NAMESPACE, value: {} }],
        replace: () => Promise.resolve(),
      };
      const access = createToolkitSettingsAccess(ctxFor(settings, fiber));
      expect(access.scope()?.get()).toEqual({ presets: {}, presetSkills: {}, sessions: {} });
    });
  });

  describe('shape probing', () => {
    it('stays unbound while the settings service is absent', () => {
      expect(createToolkitSettingsAccess(ctxFor(undefined)).scope()).toBeUndefined();
    });

    // A service that exists but exposes neither API generation (register from
    // ≤0.1.6, describe/replace from 0.1.7) is not usable: the access layer must
    // degrade to "no scope" — the route reports a 503 — rather than guess.
    it.each([
      ['a non-object service', 42],
      ['null', null],
      ['neither settings API', { writable: true }],
    ])('returns undefined for %s', (_label, settings) => {
      expect(createToolkitSettingsAccess(ctxFor(settings)).scope()).toBeUndefined();
    });

    it('uses the legacy register path when that is what the host offers', async () => {
      const replace = vi.fn(() => Promise.resolve());
      const register = vi.fn(() => ({
        get: () => ({ presets: { alpha: ['bash'] }, presetSkills: {}, sessions: {} }),
        replace,
      }));
      const access = createToolkitSettingsAccess(ctxFor({ register }));
      expect(access.scope()?.get().presets).toEqual({ alpha: ['bash'] });
      await access.scope()?.replace({ presets: {} });
      expect(register).toHaveBeenCalledWith(TOOLKIT_SETTINGS_NAMESPACE, expect.anything(), { applies: 'live' });
      // A second register() for one namespace throws "already registered", so
      // the bound scope is memoized against the same service instance.
      access.scope()?.get();
      access.scope()?.get();
      expect(register).toHaveBeenCalledTimes(1);
    });

    it('binds lazily: a service that appears later still resolves on the next read', () => {
      const services: Record<string, unknown> = {};
      const ctx = { get: (name: string) => services[name] } as never;
      const access = createToolkitSettingsAccess(ctx);
      expect(access.scope()).toBeUndefined();
      services['settings'] = { describe: () => [{ ns: TOOLKIT_SETTINGS_NAMESPACE, value: {} }], replace: () => Promise.resolve() };
      expect(access.scope()?.get()).toEqual({ presets: {}, presetSkills: {}, sessions: {} });
    });
  });

  describe('serialize', () => {
    it('runs work in submission order and keeps the queue alive after a failure', async () => {
      const access = createToolkitSettingsAccess(ctxFor(undefined));
      const order: string[] = [];
      const failed = access.serialize(() => {
        order.push('a');
        return Promise.reject(new Error('boom'));
      });
      const later = access.serialize(() => {
        order.push('b');
        return Promise.resolve('ok');
      });
      await expect(failed).rejects.toThrow('boom');
      await expect(later).resolves.toBe('ok');
      expect(order).toEqual(['a', 'b']);
    });
  });
});