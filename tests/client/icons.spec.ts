import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

// The real package imports CSS and cannot execute under Node. The mock must
// define every name icons.ts touches: its resolver probes the modern
// (0.1.7 stroke-weight) name first, so both generations' names are provided.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => {
  const stub = (): null => null;
  return {
    IconChevronDownOutlineRegular: stub, IconChevronDownOutline14: stub,
    IconChevronRightOutlineRegular: stub, IconChevronRightOutline14: stub,
    IconContextInjectionOutlineRegular: stub, IconContextInjectionOutline16: stub,
    IconFolderCloseRegular: stub, IconFolderClose16: stub,
    IconRefreshOutlineRegular: stub, IconRefreshOutline14: stub,
    IconSearchOutlineRegular: stub, IconSearchOutline16: stub,
    IconSendOutlineRegular: stub, IconSendOutline14: stub,
    IconSettingsOutlineRegular: stub, IconSettingsOutline16: stub,
  };
});

import { pickIcon, MissingIcon, hasModernShell, HOST_HAS_MODERN_SHELL, type IconComponent, IconChevronDown, IconChevronRight, IconContextInjection, IconFolderClose, IconRefresh, IconSearch, IconSend, IconSettings } from '../../src/client/icons.js';

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

describe('resolved icon constants', () => {
  it('resolves every icon this panel renders to a component', () => {
    for (const icon of [IconChevronDown, IconChevronRight, IconContextInjection, IconFolderClose, IconRefresh, IconSearch, IconSend, IconSettings]) {
      expect(typeof icon).toBe('function');
    }
  });

  // The primitives package imports CSS, so it cannot be executed under Node;
  // this instead pins the fallback NAME pairs against the installed package's
  // source text — a typoed legacy name would silently resolve to MissingIcon
  // on pre-0.1.7 hosts, which is exactly the failure this check exists to catch.
  it('uses legacy fallback names the installed primitives package really ships', () => {
    const require = createRequire(import.meta.url);
    const entry = require.resolve('@deepseek-ai/dsh-client-ui-primitives');
    const source = readFileSync(entry, 'utf8');
    for (const legacy of [
      'IconChevronDownOutline14',
      'IconChevronRightOutline14',
      'IconContextInjectionOutline16',
      'IconFolderClose16',
      'IconRefreshOutline14',
      'IconSearchOutline16',
      'IconSendOutline14',
      'IconSettingsOutline16',
    ]) {
      expect(source).toContain(legacy);
    }
  });
});

