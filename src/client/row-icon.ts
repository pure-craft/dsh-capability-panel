/**
 * The leading mark of one capability row.
 *
 * Both panels list the same three kinds of thing, and each kind already has a
 * glyph in the host's own surfaces. Picking them here — once, from the host's
 * library — keeps the two panels from drifting and keeps the panel from
 * inventing marks the host never uses:
 *
 *  - SKILL: `dsh-client-ui-skill`'s SkillRow leads every skill with
 *    `IconSkillOutlineRegular` at 14px (`disclosureLeading`).
 *  - TOOL: the host's tool cards resolve a leading glyph per tool variant
 *    (`VARIANT_ICONS` in `dsh-client-ui-tool`) — bash/command IconApi, read
 *    IconBrowse, write/edit IconEdit, code IconCode, search IconSearch, and
 *    every other tool IconSparkle. A tool DEFINITION row has no call to
 *    classify, so the name is classified into that same vocabulary below.
 *  - EXTENSION/SERVER: `dsh-client-ui-cordis` marks a loaded extension with
 *    `IconCordisPluginOutlineRegular`. An MCP server is the same kind of thing —
 *    an installed extension that contributes tools — and it must NOT borrow the
 *    panel trigger's `IconContextInjection`, which in the host means context
 *    injection (and is the panel's own entry mark).
 */
import * as React from 'react';
import {
  IconApi,
  IconBrowse,
  IconCode,
  IconCordisPlugin,
  IconEdit,
  IconSearch,
  IconSkill,
  IconSparkle,
  type IconComponent,
} from './icons.js';

/** The host's own tool-card variants, spelled as its `VARIANT_ICONS` table does. */
export type ToolVariant = 'search' | 'read' | 'bash' | 'write' | 'code' | 'others';

/** One glyph per host variant. Every entry is a host name, none is drawn here. */
const VARIANT_ICONS: Readonly<Record<ToolVariant, IconComponent>> = {
  search: IconSearch,
  read: IconBrowse,
  bash: IconApi,
  write: IconEdit,
  code: IconCode,
  others: IconSparkle,
};

/**
 * Name → variant rules, first match wins, matched on word starts so `web_search`
 * classifies as search and `todo_write` as write. Order matters: `run_code` is
 * code, not a `create`-like write, so the code rule is tested first.
 */
const VARIANT_RULES: readonly (readonly [RegExp, ToolVariant])[] = [
  [/(^|_)(bash|shell|exec|terminal|command|script)/, 'bash'],
  [/(^|_)(code|eval|python|node|repl)/, 'code'],
  [/(^|_)(search|grep|glob|find|match|query|scan)/, 'search'],
  [/(^|_)(write|edit|patch|replace|update|notebook)/, 'write'],
  [/(^|_)(read|view|open|fetch|browse|list|cat|show|get|info|describe)/, 'read'],
];

/** Which host variant a tool name belongs to; unknown names take `others`. */
export function toolVariant(name: string): ToolVariant {
  const lowered = name.toLowerCase();
  for (const [pattern, variant] of VARIANT_RULES) {
    if (pattern.test(lowered)) return variant;
  }
  return 'others';
}

/** A skill row leads with the host's own skill glyph. */
export function skillRowIcon(): React.ReactElement {
  return React.createElement(IconSkill, { size: 14 });
}

/** An MCP server row leads with the host's own extension glyph. */
export function serverRowIcon(): React.ReactElement {
  return React.createElement(IconCordisPlugin, { size: 14 });
}

/** A tool row leads with the glyph the host gives that tool's variant. */
export function toolRowIcon(name: string): React.ReactElement {
  return React.createElement(VARIANT_ICONS[toolVariant(name)], { size: 14 });
}