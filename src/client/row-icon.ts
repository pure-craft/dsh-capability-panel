/**
 * The leading mark of one capability row.
 *
 * The mark answers one question — what KIND of thing is this row — with the
 * glyph the host itself gives that kind, so the two panels never drift and the
 * panel never invents a mark the host does not use:
 *
 *  - SKILL: `dsh-client-ui-skill`'s SkillRow leads every skill with
 *    `IconSkillOutlineRegular` at 14px (`disclosureLeading`).
 *  - EXTENSION/SERVER: `dsh-client-ui-cordis` marks a loaded extension with
 *    `IconCordisPluginOutlineRegular`. An MCP server is the same kind of thing —
 *    an installed extension that contributes tools.
 *  - TOOL: `others` in the host's own tool vocabulary — `IconSparkleRegular`,
 *    the mark `dsh-client-ui-tool` falls back to for a tool it cannot classify.
 *
 * Tools deliberately carry NO per-type glyph. The host classifies a tool by
 * looking its name up in a fixed table of its OWN built-ins and calling every
 * other tool `others` (`classifyTool` in `dsh-client-ui-tool`), and for good
 * reason: a tool name does not state what a tool does. Most tool rows here are
 * MCP tools from third-party servers, named by their authors — matching those
 * names against keywords would paint rows with categories the host never claims
 * (a server's `get_info` is not a "read tool", `execute_pipeline_job_run` is not
 * a shell). One honest mark for the whole kind beats a guess per row.
 */
import * as React from 'react';
import { IconCordisPlugin, IconSkill, IconSparkle } from './icons.js';

/** A skill row leads with the host's own skill glyph. */
export function skillRowIcon(): React.ReactElement {
  return React.createElement(IconSkill, { size: 14 });
}

/** An MCP server row leads with the host's own extension glyph. */
export function serverRowIcon(): React.ReactElement {
  return React.createElement(IconCordisPlugin, { size: 14 });
}

/** Every tool row leads with the host's unclassified-tool glyph. */
export function toolRowIcon(): React.ReactElement {
  return React.createElement(IconSparkle, { size: 14 });
}