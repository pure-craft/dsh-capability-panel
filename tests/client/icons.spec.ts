import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

// The real package imports CSS and cannot execute under Node. The shared stub
// defines every name icons.ts touches: its resolver probes the modern
// (0.1.7 stroke-weight) name first, so both generations' names are provided.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => (await import('./primitives-stub.js')).primitivesStub);

import { pickIcon, MissingIcon, hasModernShell, HOST_HAS_MODERN_SHELL, ICON_NAME_PAIRS, type IconComponent, IconChevronDown, IconChevronUp, IconCordisPlugin, IconFolderClose, IconPanelLeft, IconPlus, IconRefresh, IconSearch, IconSettings, IconSkill, IconSliders, IconSparkle, IconTriangleRight } from '../../src/client/icons.js';

const Modern: IconComponent = () => null;
const Legacy: IconComponent = () => null;

describe('pickIcon', () => {
  // 0.1.7 hosts renamed the icon set from pixel suffixes (…Outline14) to stroke
  // weights (…OutlineRegular); the resolver is what keeps one client build
  // mountable on both generations.
  it('prefers the modern stroke-weight name when both exist', () => {
    expect(pickIcon({ IconNewRegular: Modern, IconNew14: Legacy }, 'IconNewRegular', 'IconNew14')).toBe(Modern);
  });

  it('falls back to the legacy pixel-suffixed name', () => {
    expect(pickIcon({ IconNew14: Legacy }, 'IconNewRegular', 'IconNew14')).toBe(Legacy);
  });

  it('degrades to the no-render sentinel when the host has neither name', () => {
    expect(pickIcon({}, 'IconNewRegular', 'IconNew14')).toBe(MissingIcon);
    // ComponentType 联合了类组件所以类型上不可直接调用；运行期它是函数组件。
    expect((MissingIcon as (props?: unknown) => null)({})).toBeNull();
  });

  it('ignores a non-component export under the icon name', () => {
    expect(pickIcon({ IconNewRegular: { not: 'a component' } }, 'IconNewRegular', 'IconNew14')).toBe(MissingIcon);
  });
});

describe('hasModernShell', () => {
  // The settings shortcut shipped in the same host generation as the
  // stroke-weight icons, so the settings entry gates on this signal.
  it('is true only when the modern icon set is present', () => {
    expect(hasModernShell({ IconSettingsOutlineRegular: () => null })).toBe(true);
    expect(hasModernShell({ IconSettingsOutline16: () => null })).toBe(false);
    expect(HOST_HAS_MODERN_SHELL).toBe(true);
  });
});

/**
 * The last primitives release that still shipped pixel-suffixed icon names,
 * frozen as a fixture because no installable 0.2.x package contains them any
 * more. Its provenance and re-derive command live in the file itself.
 */
function frozenLegacyIconExports(): string[] {
  const file = new URL('../fixtures/primitives-0.1.5-alpha.1-icon-exports.json', import.meta.url);
  return (JSON.parse(readFileSync(file, 'utf8')) as { icons: string[] }).icons;
}

describe('resolved icon constants', () => {
  const resolved: Record<string, IconComponent> = {
    IconChevronDown, IconChevronUp, IconCordisPlugin, IconFolderClose, IconPanelLeft,
    IconPlus, IconRefresh, IconSearch, IconSettings, IconSkill, IconSliders,
    IconSparkle, IconTriangleRight,
  };

  it('resolves every name pair to a live host icon, never the sentinel', () => {
    // MissingIcon is itself a function, so its absence has to be asserted by
    // identity: a typeof check cannot tell a real host icon from a name that
    // fell through to the degradation path.
    expect(Object.keys(resolved).sort()).toEqual(Object.keys(ICON_NAME_PAIRS).sort());
    for (const [name, icon] of Object.entries(resolved)) {
      expect(icon, name).not.toBe(MissingIcon);
    }
  });

  // The primitives package imports CSS, so it cannot be executed under Node.
  // Each generation is therefore pinned against the export list that really
  // ships it — a typoed name would otherwise degrade to MissingIcon *silently*
  // on that generation, which is exactly the failure this check exists to catch:
  //  - modern: the INSTALLED package's source text, the generation this build
  //    is type-checked and tested against;
  //  - legacy: the frozen 0.1.5-alpha.1 list, since 0.2.x dropped those names.
  it('pins both name generations against the export list that really ships them', () => {
    const require = createRequire(import.meta.url);
    const entry = require.resolve('@deepseek-ai/dsh-client-ui-primitives');
    const source = readFileSync(entry, 'utf8');
    const legacyExports = frozenLegacyIconExports();
    for (const [name, pair] of Object.entries(ICON_NAME_PAIRS)) {
      expect(source, `${name}: is the installed package's ${pair.modern} present?`).toContain(pair.modern);
      expect(legacyExports, `${name}: did 0.1.5-alpha.1 really export ${pair.legacy}?`).toContain(pair.legacy);
    }
  });
});

