/**
 * Usage statistics: did the agent still reach for a capability AFTER the user
 * turned it off? That answer drives the panel's optimization direction, so it
 * must be measured, not guessed.
 *
 * Detection is pure (this module has no I/O): the host feeds every
 * `tools/result` observation through {@link classifyBlockedCall} and appends
 * the returned record to a JSONL log. Two blocked shapes exist:
 *
 * - skill: the `skill` loader tool is still registered (only the catalog entry
 *   is shadowed), so a blocked attempt fails INSIDE the tool with
 *   "not available for model invocation". The skill name rides the arguments.
 * - mcp: a restricted tool is invisible, so dispatch fails BEFORE the body
 *   with code UNKNOWN_TOOL. The tool name is the call name itself.
 *
 * Toggle operations are logged too (kind 'disable'/'enable') so later analysis
 * can correlate "turned off at T" with "attempted at T+n".
 */

/** Stable prefix of the guard's denial text, marking a hard call to a preset-layer tool the user turned off. */
export const GUARD_DENIAL_PREFIX = 'agent-toolkit: tool disabled';

export interface StatsRecord {
  readonly ts: string;
  readonly sessionId: string | null;
  readonly kind: 'disable' | 'enable' | 'blocked-skill' | 'blocked-tool';
  /** Skill name or full tool name, by kind. */
  readonly name: string;
  readonly detail?: string;
}

/** Minimal readonly view of a settled tool call, as `tools/result` hands it over. */
export interface SettledCall {
  readonly name?: unknown;
  readonly arguments?: unknown;
  readonly agent?: { readonly id?: unknown };
  readonly error?: { readonly message?: unknown; readonly info?: { readonly code?: unknown } };
}

/**
 * Classify one settled call against the session's CURRENT disabled sets.
 * Returns null for everything that is not a blocked attempt — including
 * unknown-tool failures for tools nobody disabled (genuine model typos).
 */
export function classifyBlockedCall(
  call: SettledCall,
  disabledSkills: ReadonlySet<string>,
  disabledToolNames: ReadonlySet<string>,
): { kind: 'blocked-skill' | 'blocked-tool'; name: string; sessionId: string | null } | null {
  if (call.error === undefined) return null;
  const sessionId = typeof call.agent?.id === 'string' ? call.agent.id : null;

  if (call.name === 'skill') {
    const message = typeof call.error.message === 'string' ? call.error.message : '';
    if (!message.includes('not available for model invocation')) return null;
    const args = call.arguments;
    const skillName =
      args !== null && typeof args === 'object' && typeof (args as { name?: unknown }).name === 'string'
        ? (args as { name: string }).name
        : null;
    if (skillName === null || !disabledSkills.has(skillName)) return null;
    return { kind: 'blocked-skill', name: skillName, sessionId };
  }

  if (typeof call.name === 'string' && disabledToolNames.has(call.name)) {
    // Global tools: restrict reports UNKNOWN_TOOL before dispatch; preset-layer tools: the guard denies before execution.
    const message = typeof call.error.message === 'string' ? call.error.message : '';
    if (call.error.info?.code !== 'UNKNOWN_TOOL' && !message.startsWith(GUARD_DENIAL_PREFIX)) return null;
    return { kind: 'blocked-tool', name: call.name, sessionId };
  }

  return null;
}

/** Aggregate a JSONL log into a name → blocked-attempt count map. */
export function aggregateBlocked(lines: Iterable<string>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    let record: StatsRecord;
    try {
      record = JSON.parse(trimmed) as StatsRecord;
    } catch {
      continue;
    }
    // 'blocked-mcp' is the pre-tool-level name for the same fact.
    if (record.kind !== 'blocked-skill' && record.kind !== 'blocked-tool' && (record.kind as string) !== 'blocked-mcp') {
      continue;
    }
    if (typeof record.name !== 'string') continue;
    counts[record.name] = (counts[record.name] ?? 0) + 1;
  }
  return counts;
}
