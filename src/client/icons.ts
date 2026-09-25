/**
 * Icon name resolution across host generations.
 *
 * dsh-client-ui-primitives renamed its entire icon set in 0.1.7: the pixel-size
 * suffixes (`IconChevronDownOutline14`) became stroke-weight variants
 * (`IconChevronDownOutlineRegular` / `…Medium`). Every usage in this panel is a
 * small utility glyph, which the host's own conversation UI renders with the
 * Regular weight — so Regular is the modern name we probe first. A static named
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

export const IconChevronRight = pickIcon(table, 'IconChevronRightOutlineRegular', 'IconChevronRightOutline14');
export const IconContextInjection = pickIcon(table, 'IconContextInjectionOutlineRegular', 'IconContextInjectionOutline16');
export const IconFolderClose = pickIcon(table, 'IconFolderCloseRegular', 'IconFolderClose16');
export const IconSend = pickIcon(table, 'IconSendOutlineRegular', 'IconSendOutline14');
export const IconSearch = pickIcon(table, 'IconSearchOutlineRegular', 'IconSearchOutline16');
export const IconRefresh = pickIcon(table, 'IconRefreshOutlineRegular', 'IconRefreshOutline14');
export const IconChevronDown = pickIcon(table, 'IconChevronDownOutlineRegular', 'IconChevronDownOutline14');
export const IconSettings = pickIcon(table, 'IconSettingsOutlineRegular', 'IconSettingsOutline16');

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