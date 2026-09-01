/**
 * The dictionaries are the panel's only copy source: a key used by the
 * component but missing from a dictionary would render the raw key (the
 * host's fail-loud fallback), and a zh/en key-set drift would make one
 * language fall back to English mid-panel. Both are caught here.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { en, LOCALE_NS, registerLocale, zh } from '../../src/client/locale.js';
import type { LocaleService } from '../../src/client/locale.js';

describe('dictionaries', () => {
  it('zh and en carry identical key sets', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });

  it('covers every key any client module looks up', () => {
    // Every client module, discovered rather than listed: the settings panel
    // was added after this guard and went unchecked, so a key it alone used
    // could be deleted with the suite still green. The key pattern allows
    // camelCase for the same reason -- `preset.projectSkill` did not match the
    // lowercase-only pattern this originally used.
    const dir = new URL('../../src/client/', import.meta.url);
    const used = new Set<string>();
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.ts'))) {
      const source = readFileSync(new URL(file, dir), 'utf8');
      for (const match of source.matchAll(/\bt\('([A-Za-z0-9.]+)'/g)) {
        if (match[1] !== undefined) used.add(match[1]);
      }
    }
    expect(used.size).toBeGreaterThan(20);
    for (const key of used) {
      expect(zh, `zh is missing ${key}`).toHaveProperty(key);
      expect(en, `en is missing ${key}`).toHaveProperty(key);
    }
    // Keys chosen at runtime, which no static scan can see: skill states
    // interpolate as `state.${state}`, the disclosure helper selects detail.*
    // through a typed union, and both panels pick the switch label from a
    // ternary on the current value.
    for (const key of [
      'state.loaded',
      'state.evicted',
      'state.unloaded',
      'detail.description',
      'detail.tools',
      'action.enable',
      'action.disable',
    ]) {
      expect(zh, `zh is missing ${key}`).toHaveProperty(key);
      expect(en, `en is missing ${key}`).toHaveProperty(key);
    }
  });

  it('interpolates the same placeholders on both sides', () => {
    for (const key of Object.keys(zh)) {
      const placeholders = (template: string) => [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(placeholders(en[key] ?? ''), `placeholder mismatch on ${key}`).toEqual(placeholders(zh[key] ?? ''));
    }
  });
});

describe('registerLocale', () => {
  function fakeLocale(): LocaleService & { registrations: { ns: string; locale: string }[]; disposed: number } {
    const registrations: { ns: string; locale: string }[] = [];
    const self = {
      registrations,
      disposed: 0,
      register(ns: string, locale: string, _dict: Record<string, string>) {
        registrations.push({ ns, locale });
        return () => {
          self.disposed += 1;
        };
      },
      bind: () => (key: string) => key,
      subscribe: () => () => {},
      getSnapshot: () => ({ active: 'zh', revision: 1 }),
    };
    return self;
  }

  it('registers both locales under the plugin namespace', () => {
    const locale = fakeLocale();
    registerLocale(locale);

    expect(locale.registrations).toEqual([
      { ns: LOCALE_NS, locale: 'zh' },
      { ns: LOCALE_NS, locale: 'en' },
    ]);
  });

  it('releases both dictionaries when disposed', () => {
    const locale = fakeLocale();
    const dispose = registerLocale(locale);
    dispose();

    expect(locale.disposed).toBe(2);
  });
});
