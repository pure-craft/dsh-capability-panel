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

    // A host can expose BOTH generations: 0.1.7 ships describe/replace, and a
    // compatibility patch (dsh-purge's settings shim) re-adds the legacy
    // `register`. Probing register first takes that branch — it reads the
    // pre-0.1.7 document instead of the entry Config, and throws
    // "already registered" on any rebind — so the panel route answered 500 on
    // every read. The modern shape must win whenever it is available.
    it('prefers describe/replace when a host exposes both settings APIs', async () => {
      const replace = vi.fn(() => Promise.resolve());
      const register = vi.fn(() => ({
        get: () => ({ presets: { legacy: ['from-shim'] }, presetSkills: {}, sessions: {} }),
        replace: () => Promise.resolve(),
      }));
      const settings = {
        register,
        describe: () => [{ ns: TOOLKIT_SETTINGS_NAMESPACE, value: { presets: { alpha: ['bash'] } } }],
        replace,
      };
      const access = createToolkitSettingsAccess(ctxFor(settings));
      expect(access.scope()?.get().presets).toEqual({ alpha: ['bash'] });
      await access.scope()?.replace({ presets: {} });
      expect(register).not.toHaveBeenCalled();
      expect(replace).toHaveBeenCalledWith(TOOLKIT_SETTINGS_NAMESPACE, { presets: {} });
    });
  });

  describe('live reads without inventory scans', () => {
    it('reads current effective Config without describe, including external replacements', async () => {
      const describe = vi.fn(() => { throw new Error('full inventory must stay lazy'); });
      const fiber: { effectiveConfig: object; entry: { options: { id: string } } } = {
        effectiveConfig: { presets: { alpha: ['bash'] } }, entry: { options: { id: 'custom-entry' } },
      };
      const settings = {
        describe,
        replace: vi.fn((_namespace: string, section: object) => {
          fiber.effectiveConfig = section;
          return Promise.resolve();
        }),
      };
      const access = createToolkitSettingsAccess(ctxFor(settings, fiber));
      expect(describe).not.toHaveBeenCalled();
      const scope = access.scope()!;
      expect(scope.get()).toEqual({ presets: { alpha: ['bash'] }, presetSkills: {}, sessions: {} });
      fiber.effectiveConfig = { presets: { beta: ['read'] } };
      expect(scope.get().presets).toEqual({ beta: ['read'] });
      await scope.replace({ sessions: { s: { skills: { office: false } } } });
      expect(scope.get().sessions).toEqual({ s: { skills: { office: false } } });
      expect(settings.replace).toHaveBeenCalledWith('custom-entry', { sessions: { s: { skills: { office: false } } } });
      expect(describe).not.toHaveBeenCalled();
    });

    it.each([null, [], 42])('falls back to descriptors for unsupported effective Config %s', (effectiveConfig) => {
      const describe = vi.fn(() => [{ ns: TOOLKIT_SETTINGS_NAMESPACE, value: { presets: { alpha: ['bash'] } } }]);
      const access = createToolkitSettingsAccess(ctxFor({ describe, replace: () => Promise.resolve() }, { effectiveConfig }));
      expect(access.scope()?.get().presets).toEqual({ alpha: ['bash'] });
      expect(describe).toHaveBeenCalledTimes(1);
    });

    it('reports a missing descriptor rather than silently discarding stored restrictions', () => {
      const access = createToolkitSettingsAccess(ctxFor({ describe: () => [], replace: () => Promise.resolve() }));
      expect(() => access.scope()?.get()).toThrow('settings entry "capability-panel" is not configurable');
    });

    it('memoizes legacy registration across fresh Cordis proxies but rebinds a real replacement', () => {
      const makeService = (name: string) => ({
        register: vi.fn(function (this: unknown) {
          expect(this).not.toBe(service);
          return { get: () => ({ presets: { [name]: ['bash'] } }), replace: () => Promise.resolve() };
        }),
      });
      let service = makeService('alpha');
      const first = service;
      const ctx = {
        get: () => new Proxy(service, {
          get: (target, key, receiver): unknown => key === Symbol.for('cordis.original') ? target : Reflect.get(target, key, receiver) as unknown,
        }),
      } as never;
      const access = createToolkitSettingsAccess(ctx);
      expect(access.scope()?.get().presets).toEqual({ alpha: ['bash'] });
      access.scope()?.get();
      expect(first.register).toHaveBeenCalledTimes(1);
      service = makeService('beta');
      expect(access.scope()?.get().presets).toEqual({ beta: ['bash'] });
      expect(service.register).toHaveBeenCalledTimes(1);
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
