/**
 * The composer panel's text filter. The rules live in `filter-core.ts` and are
 * shared with the settings panel; this module fixes them to the session wire
 * types so the component keeps its exact payload shape.
 */
import { filterCapabilities } from './filter-core.js';
import type { FilteredCapabilities } from './filter-core.js';
import type { InspectorPayload, McpServerEntry, SkillEntry, ToolEntry } from '../contract.js';

export type FilteredPayload = FilteredCapabilities<SkillEntry, ToolEntry, McpServerEntry>;

export function filterPayload(payload: InspectorPayload, rawQuery: string): FilteredPayload {
  return filterCapabilities(payload, rawQuery);
}
