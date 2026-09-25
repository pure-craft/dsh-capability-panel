// TEMPORARY(dsh-0.1.7-migration) — 与 src/host/legacy-import.ts 同生共死。
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from 'node:process';
import { describe, expect, it } from 'vitest';
import {
  legacySettingsDir,
  readLegacyToolkitSection,
  recoverLegacyToolkitSection,
  scheduleLegacyRecovery,
} from '../../src/host/legacy-import.js';
import type { ToolkitSettings } from '../../src/host/types.js';
import type { ToolkitSettingsAccess } from '../../src/host/settings-scope.js';

const EMPTY: ToolkitSettings = { presets: {}, presetSkills: {}, sessions: {} };

function dir(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-legacy-import-'));
}

/** A mock access whose scope reads `stored` and records every replace. */
function accessWith(stored: ToolkitSettings) {
  const replaces: object[] = [];
  const access: ToolkitSettingsAccess = {
    scope: () => ({
      get: () => stored,
      replace: (section: object) => {
        replaces.push(section);
        return Promise.resolve();
      },
    }),
    serialize: (work) => work(),
  };
  return { access, replaces };
}

const noScopeAccess: ToolkitSettingsAccess = {
  scope: () => undefined,
  serialize: (work) => work(),
};

const LEGACY_DOC = [
  'capability-panel:',
  '  presets:',
  '    probe-custom:',
  '      - web_search',
  '  sessions: {}',
  'other-plugin:',
  '  whatever: true',
  '',
].join('\n');

describe('legacySettingsDir', () => {
  it('honors DSH_HOME and falls back to the home directory', () => {
    expect(legacySettingsDir({ DSH_HOME: '/custom' })).toBe('/custom');
    expect(legacySettingsDir({}, '/home/u')).toBe('/home/u/.dsh');
  });
});

describe('readLegacyToolkitSection', () => {
  it('returns undefined for a missing file', () => {
    expect(readLegacyToolkitSection(join(dir(), 'nope.yaml'))).toBeUndefined();
  });

  it.each([
    ['unparseable YAML', 'presets: [unclosed'],
    ['a null document', '# only a comment\n'],
    ['a scalar document', '42\n'],
    ['no capability-panel section', 'other-plugin:\n  x: 1\n'],
    ['a scalar section', 'capability-panel: 42\n'],
  ])('returns undefined for %s', (_label, content) => {
    const file = join(dir(), 'settings.yaml.imported');
    writeFileSync(file, content);
    expect(readLegacyToolkitSection(file)).toBeUndefined();
  });

  it('reads and normalizes the stored section, ignoring foreign sections', () => {
    const file = join(dir(), 'settings.yaml.imported');
    writeFileSync(file, LEGACY_DOC);
    expect(readLegacyToolkitSection(file)).toEqual({
      presets: { 'probe-custom': ['web_search'] },
      presetSkills: {},
      sessions: {},
    });
  });
});

describe('recoverLegacyToolkitSection', () => {
  it('seeds the legacy section when everything is empty', async () => {
    const home = dir();
    writeFileSync(join(home, 'settings.yaml.imported'), LEGACY_DOC);
    const { access, replaces } = accessWith(EMPTY);
    const outcome = await recoverLegacyToolkitSection(access, () => false, { DSH_HOME: home });
    expect(outcome).toBe('seeded');
    expect(replaces).toEqual([{ presets: { 'probe-custom': ['web_search'] }, presetSkills: {}, sessions: {} }]);
  });

  it('does nothing when the plugin was already disposed', async () => {
    const { access, replaces } = accessWith(EMPTY);
    const outcome = await recoverLegacyToolkitSection(access, () => true, { DSH_HOME: dir() });
    expect(outcome).toBe('skipped:disposed');
    expect(replaces).toEqual([]);
  });

  it('stays out of the way while the host migrator still has settings.yaml', async () => {
    const home = dir();
    writeFileSync(join(home, 'settings.yaml'), LEGACY_DOC);
    writeFileSync(join(home, 'settings.yaml.imported'), LEGACY_DOC);
    const { access, replaces } = accessWith(EMPTY);
    const outcome = await recoverLegacyToolkitSection(access, () => false, { DSH_HOME: home });
    expect(outcome).toBe('skipped:active-document-present');
    expect(replaces).toEqual([]);
  });

  it('skips when no imported section exists', async () => {
    const { access } = accessWith(EMPTY);
    const outcome = await recoverLegacyToolkitSection(access, () => false, { DSH_HOME: dir() });
    expect(outcome).toBe('skipped:no-imported-section');
  });

  it('skips an empty legacy section rather than writing empty maps', async () => {
    const home = dir();
    writeFileSync(join(home, 'settings.yaml.imported'), 'capability-panel:\n  presets: {}\n');
    const { access, replaces } = accessWith(EMPTY);
    const outcome = await recoverLegacyToolkitSection(access, () => false, { DSH_HOME: home });
    expect(outcome).toBe('skipped:legacy-section-empty');
    expect(replaces).toEqual([]);
  });

  it('skips when the settings scope is unavailable', async () => {
    const home = dir();
    writeFileSync(join(home, 'settings.yaml.imported'), LEGACY_DOC);
    const outcome = await recoverLegacyToolkitSection(noScopeAccess, () => false, { DSH_HOME: home });
    expect(outcome).toBe('skipped:no-scope');
  });

  // The newest data always wins: a user who already toggled something after the
  // failed host migration must never be rolled back to the older snapshot.
  it('never overwrites a section that already has data', async () => {
    const home = dir();
    writeFileSync(join(home, 'settings.yaml.imported'), LEGACY_DOC);
    const { access, replaces } = accessWith({ ...EMPTY, presets: { alpha: ['bash'] } });
    const outcome = await recoverLegacyToolkitSection(access, () => false, { DSH_HOME: home });
    expect(outcome).toBe('skipped:section-not-empty');
    expect(replaces).toEqual([]);
  });

  it('degrades to a skipped outcome when the write fails, leaving a retry for next boot', async () => {
    const home = dir();
    writeFileSync(join(home, 'settings.yaml.imported'), LEGACY_DOC);
    const failing: ToolkitSettingsAccess = {
      scope: () => ({ get: () => EMPTY, replace: () => Promise.reject(new Error('not configurable')) }),
      serialize: (work) => work(),
    };
    const outcome = await recoverLegacyToolkitSection(failing, () => false, { DSH_HOME: home });
    expect(outcome).toBe('skipped:write-failed');
  });
});

describe('scheduleLegacyRecovery', () => {
  function ctxWith(loader: unknown) {
    const disposers: (() => void)[] = [];
    const ctx = {
      get: (name: string) => (name === 'loader' ? loader : undefined),
      effect: (fn: () => () => void) => disposers.push(fn()),
    };
    return { ctx: ctx as never, disposers };
  }

  async function flush(): Promise<void> {
    for (let index = 0; index < 10; index++) await Promise.resolve();
  }

  it('recovers once the loader settles, reading DSH_HOME at recovery time', async () => {
    writeFileSync(join(env['DSH_HOME']!, 'settings.yaml.imported'), LEGACY_DOC);
    const { ctx } = ctxWith({ entries: () => [], await: () => Promise.resolve() });
    const { access, replaces } = accessWith(EMPTY);
    scheduleLegacyRecovery(ctx, access);
    await flush();
    expect(replaces).toEqual([{ presets: { 'probe-custom': ['web_search'] }, presetSkills: {}, sessions: {} }]);
  });

  it('still recovers when loader.await rejects', async () => {
    writeFileSync(join(env['DSH_HOME']!, 'settings.yaml.imported'), LEGACY_DOC);
    const { ctx } = ctxWith({ entries: () => [], await: () => Promise.reject(new Error('boot failed')) });
    const { access, replaces } = accessWith(EMPTY);
    scheduleLegacyRecovery(ctx, access);
    await flush();
    expect(replaces).toHaveLength(1);
  });

  it('runs immediately on a loader that predates await()', async () => {
    const { ctx } = ctxWith({ entries: () => [] });
    const { access } = accessWith(EMPTY);
    // No settings.yaml.imported in this file's DSH_HOME → a clean no-op skip.
    scheduleLegacyRecovery(ctx, access);
    await flush();
  });

  it('stops once the plugin is disposed', async () => {
    writeFileSync(join(env['DSH_HOME']!, 'settings.yaml.imported'), LEGACY_DOC);
    let gate!: () => void;
    const { ctx, disposers } = ctxWith({ entries: () => [], await: () => new Promise<void>((resolve) => (gate = resolve)) });
    const { access, replaces } = accessWith(EMPTY);
    scheduleLegacyRecovery(ctx, access);
    for (const dispose of disposers) dispose();
    gate();
    await flush();
    expect(replaces).toEqual([]);
  });
});