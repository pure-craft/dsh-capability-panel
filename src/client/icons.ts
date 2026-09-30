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
  // The row-leading marks, each one the glyph the host's own surface for that
  // subject already uses — never a lookalike:
  //  - a SKILL row: `dsh-client-ui-skill`'s SkillRow leads with IconSkill at 14px;
  //  - a TOOL row: the host's `others` fallback, IconSparkle — the glyph
  //    `dsh-client-ui-tool` gives a tool its own name table cannot classify
  //    (which is every tool that is not one of the host's built-ins; see
  //    row-icon.ts for why the panel does not guess tool types from names);
  //  - an extension/server row: `dsh-client-ui-cordis` marks a loaded extension
  //    with IconCordisPlugin;
  //  - the panel's own trigger takes the host's sliders artwork — the family the
  //    host's own option popovers use (ui-workspace draws its two-row sibling
  //    for view options) — because the panel IS a set of per-session switches.
  //    The host ships this artwork under its `Personalization` name and no host
  //    surface renders it, so the trigger collides with nothing;
  //  - a row action: PanelLeft is the glyph both host sidebars use for the side
  //    panel (ui-sidebar-right draws it for expand/collapse), so "open this
  //    skill's instruction file in the side panel" wears the host's own mark for
  //    that destination; Plus is the host's plain "add" (add model, add
  //    workspace, add task), which reads as "put /name into the composer".
  //    Both replaced arrow glyphs (RightUp ↗, Send ↑) that sat next to each other
  //    reading as two near-identical arrows.
  IconSkill: { modern: 'IconSkillOutlineRegular', legacy: 'IconSkillOutline16' },
  IconSparkle: { modern: 'IconSparkleRegular', legacy: 'IconSparkle16' },
  IconCordisPlugin: { modern: 'IconCordisPluginOutlineRegular', legacy: 'IconCordisPluginOutline14' },
  IconSliders: { modern: 'IconPersonalizationOutlineRegular', legacy: 'IconPersonalizationOutline16' },
  IconPanelLeft: { modern: 'IconPanelLeftOutlineRegular', legacy: 'IconPanelLeftOutline16' },
  IconPlus: { modern: 'IconPlusOutlineRegular', legacy: 'IconPlusOutline16' },
  IconFolderClose: { modern: 'IconFolderCloseRegular', legacy: 'IconFolderClose16' },
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
export const IconSparkle = resolveIcon(ICON_NAME_PAIRS.IconSparkle);
export const IconCordisPlugin = resolveIcon(ICON_NAME_PAIRS.IconCordisPlugin);
export const IconSliders = resolveIcon(ICON_NAME_PAIRS.IconSliders);
export const IconPanelLeft = resolveIcon(ICON_NAME_PAIRS.IconPanelLeft);
export const IconPlus = resolveIcon(ICON_NAME_PAIRS.IconPlus);
export const IconFolderClose = resolveIcon(ICON_NAME_PAIRS.IconFolderClose);
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