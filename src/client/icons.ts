/**
 * Icon name resolution across host generations.
 *
 * dsh-client-ui-primitives renamed its entire icon set in 0.1.7: the pixel-size
 * suffixes (`IconChevronDownOutline14`) became stroke-weight variants
 * (`IconChevronDownOutlineRegular` / `…Medium`), which share one artwork and
 * differ only in `strokeWidth` (measured: Regular 1, Medium 1.3). The weight we
 * probe first is the one the host's own surface for that affordance uses — the
 * Regular weight everywhere except the settings gear, which the host's
 * settings-general renders `Medium`. A static named
 * import of a missing export would yield `undefined`, and React treats an
 * undefined element type as a fatal render error — the whole panel would fail
 * to mount. Resolving by property lookup keeps one build working on both
 * generations, and a host that renamed things again degrades to an icon-less
 * but fully functional panel instead of a crash.
 */
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives';
import type { ComponentType } from 'react';

/** The props every host icon component accepts. */
export interface IconProps {
  size?: number;
  className?: string;
}

export type IconComponent = ComponentType<IconProps>;

/** Rendered when a host generation has neither name: the panel stays usable. */
export const MissingIcon: IconComponent = () => null;

/**
 * Pick the first export name the host's primitives package actually provides.
 * Exported separately from the module-level constants so tests can drive every
 * branch with a fake table.
 */
export function pickIcon(table: Readonly<Record<string, unknown>>, modern: string, legacy: string): IconComponent {
  const found = table[modern] ?? table[legacy];
  return typeof found === 'function' ? (found as IconComponent) : MissingIcon;
}

const table = primitives as unknown as Readonly<Record<string, unknown>>;

/**
 * Every icon the panel renders, with both generations' export names side by
 * side: `modern` is the 0.1.7+ stroke-weight name, `legacy` the pixel-suffixed
 * name it replaced. Kept as data (instead of being inlined into the constants
 * below) so tests can pin each half against the export list that really ships
 * it — the modern names against the installed package, the legacy names
 * against the last release that still had them.
 */
export const ICON_NAME_PAIRS = {
  // The three row-leading marks. The host's own records put a domain glyph in
  // that slot — `IconApi` is literally what its bash/command rows pass, at 14px
  // inside the 16px leading box — and `IconSkill` is the primitives set's own
  // glyph for a skill.
  IconSkill: { modern: 'IconSkillOutlineRegular', legacy: 'IconSkillOutline16' },
  IconApi: { modern: 'IconApiOutlineRegular', legacy: 'IconApiOutline14' },
  IconContextInjection: { modern: 'IconContextInjectionOutlineRegular', legacy: 'IconContextInjectionOutline16' },
  IconFolderClose: { modern: 'IconFolderCloseRegular', legacy: 'IconFolderClose16' },
  IconSend: { modern: 'IconSendOutlineRegular', legacy: 'IconSendOutline14' },
  IconRightUp: { modern: 'IconRightUpOutlineRegular', legacy: 'IconRightUpOutline14' },
  IconSearch: { modern: 'IconSearchOutlineRegular', legacy: 'IconSearchOutline16' },
  IconRefresh: { modern: 'IconRefreshOutlineRegular', legacy: 'IconRefreshOutline14' },
  IconChevronDown: { modern: 'IconChevronDownOutlineRegular', legacy: 'IconChevronDownOutline14' },
  IconChevronUp: { modern: 'IconChevronUpOutlineRegular', legacy: 'IconChevronUpOutline14' },
  IconSettings: { modern: 'IconSettingsOutlineMedium', legacy: 'IconSettingsOutline16' },
  IconTriangleRight: { modern: 'IconTriangleRightFillRegular', legacy: 'IconTriangleRightFill14' },
} as const satisfies Record<string, { modern: string; legacy: string }>;

/** Resolve one pair against the host's own export table. */
function resolveIcon(pair: { modern: string; legacy: string }): IconComponent {
  return pickIcon(table, pair.modern, pair.legacy);
}

export const IconSkill = resolveIcon(ICON_NAME_PAIRS.IconSkill);
export const IconApi = resolveIcon(ICON_NAME_PAIRS.IconApi);
export const IconContextInjection = resolveIcon(ICON_NAME_PAIRS.IconContextInjection);
export const IconFolderClose = resolveIcon(ICON_NAME_PAIRS.IconFolderClose);
export const IconSend = resolveIcon(ICON_NAME_PAIRS.IconSend);
export const IconRightUp = resolveIcon(ICON_NAME_PAIRS.IconRightUp);
export const IconSearch = resolveIcon(ICON_NAME_PAIRS.IconSearch);
export const IconRefresh = resolveIcon(ICON_NAME_PAIRS.IconRefresh);
export const IconChevronDown = resolveIcon(ICON_NAME_PAIRS.IconChevronDown);
export const IconChevronUp = resolveIcon(ICON_NAME_PAIRS.IconChevronUp);
export const IconSettings = resolveIcon(ICON_NAME_PAIRS.IconSettings);
export const IconTriangleRight = resolveIcon(ICON_NAME_PAIRS.IconTriangleRight);

/**
 * Whether the host ships the 0.1.7 stroke-weight icon set. Exported as a
 * function so tests can drive both branches; the module constant resolves it
 * against the real package.
 *
 * One consumer: the footer settings entry. The `settings.open` keybinding that
 * entry drives shipped in the SAME host generation as the renamed icon set
 * (verified: 0.1.6's settings bundle has no such binding), so this is the
 * closest client-visible signal that the shortcut exists. If a future host
 * renames icons again this reads false and the entry hides — the safe
 * direction.
 */
export function hasModernShell(table: Readonly<Record<string, unknown>>): boolean {
  return typeof table['IconSettingsOutlineRegular'] === 'function';
}

export const HOST_HAS_MODERN_SHELL = hasModernShell(table);