/**
 * The icon table a host primitives package would expose, for tests that render
 * panel components under Node.
 *
 * The real package cannot be imported here at all: it pulls in CSS modules and
 * packages (`clsx`) that only resolve inside the host's own module graph. Every
 * name the panel can touch is therefore listed below — the resolver probes the
 * modern (0.1.7+ stroke-weight) name first and falls back to the pixel-suffixed
 * one, so both generations are present, plus `IconSettingsOutlineRegular`, which
 * the modern-shell probe reads. A missing name is not a subtle gap: the module
 * mock throws on any export the mocked module does not define.
 */
const NAMES = [
  'IconCordisPluginOutlineRegular', 'IconCordisPluginOutline14',
  'IconSkillOutlineRegular', 'IconSkillOutline16',
  'IconSparkleRegular', 'IconSparkle16',
  'IconChevronDownOutlineRegular', 'IconChevronDownOutline14',
  'IconChevronUpOutlineRegular', 'IconChevronUpOutline14',
  'IconFolderCloseRegular', 'IconFolderClose16',
  'IconPanelLeftOutlineRegular', 'IconPanelLeftOutline16',
  'IconPersonalizationOutlineRegular', 'IconPersonalizationOutline16',
  'IconPlusOutlineRegular', 'IconPlusOutline16',
  'IconRefreshOutlineRegular', 'IconRefreshOutline14',
  'IconSearchOutlineRegular', 'IconSearchOutline16',
  'IconSettingsOutlineMedium', 'IconSettingsOutlineRegular', 'IconSettingsOutline16',
  'IconTriangleRightFillRegular', 'IconTriangleRightFill14',
] as const;

/**
 * One fresh component per name. Icon identity is load-bearing in this panel —
 * the disclosure row checks that closed and open resolve to *different* glyphs,
 * and the resolver checks for its missing-icon sentinel — so a single shared
 * stub function would satisfy every name and let those checks pass for the
 * wrong reason.
 */
export const primitivesStub: Readonly<Record<string, () => null>> = Object.fromEntries(
  NAMES.map((name) => [name, (): null => null]),
);