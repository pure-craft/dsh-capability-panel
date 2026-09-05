/**
 * The composer panel's text filter. The rules live in `filter-core.ts` and are
 * shared with the settings panel; this module fixes them to the session wire
 * types and adds the one field only this panel has: the localized load-state
 * pill, so a query can match what the row visibly says (已截断/truncated).
 */
import { filterCapabilities } from './filter-core.js';
import type { FilteredCapabilities } from './filter-core.js';
import type { InspectorPayload, McpServerEntry, SkillEntry, ToolEntry } from '../contract.js';

type LabeledSkill = SkillEntry & { readonly stateLabel?: string };

export type FilteredPayload = FilteredCapabilities<LabeledSkill, ToolEntry, McpServerEntry>;

export function filterPayload(
  payload: InspectorPayload,
  rawQuery: string,
  // Default matches the raw state key, so 'pruned' finds pruned rows even
  // before a locale is wired in.
  stateLabel: (skill: SkillEntry) => string = (skill) => skill.state,
): FilteredPayload {
  // Blank query returns the payload's own rows untouched — the panel's
  // rendering relies on that reference identity to skip work.
  if (rawQuery.trim() === '') return filterCapabilities(payload, rawQuery);
  const skills: LabeledSkill[] = payload.skills.map((skill) => ({ ...skill, stateLabel: stateLabel(skill) }));
  return filterCapabilities({ ...payload, skills }, rawQuery);
}
