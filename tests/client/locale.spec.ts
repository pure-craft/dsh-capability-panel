/**
 * The dictionaries are the panel's only copy source: a key used by the
 * component but missing from a dictionary would render the raw key (the
 * host's fail-loud fallback), and a zh/en key-set drift would make one
 * language fall back to English mid-panel. Both are caught here.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { en, LOCALE_NS, registerLocale, zh } from '../../src/client/locale.js';
import type { LocaleService } from '../../src/client/locale.js';

describe('dictionaries', () => {
  it('zh and en carry identical key sets', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });

  it('covers every key the component looks up', () => {
    // Static keys: t('key', ...) calls in the client entry.
    const source = readFileSync(new URL('../../src/client/index.ts', import.meta.url), 'utf8');
    const used = new Set(
      [...source.matchAll(/\bt\('([a-z0-9.]+)'/g)]
        .map((match) => match[1])
        .filter((key): key is string => key !== undefined),
    );
    expect(used.size).toBeGreaterThan(20);
    for (const key of used) {
      expect(zh, `zh is missing ${key}`).toHaveProperty(key);
      expect(en, `en is missing ${key}`).toHaveProperty(key);
    }
    // Dynamic keys: skill states interpolate as `state.${state}`, and the
    // disclosure helper selects detail.* through a typed union variable.
    for (const key of ['state.loaded', 'state.evicted', 'state.unloaded', 'detail.description', 'detail.tools']) {
      expect(zh).toHaveProperty(key);
      expect(en).toHaveProperty(key);
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
