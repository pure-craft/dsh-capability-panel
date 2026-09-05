/**
 * Skill load state, read off the LIVE session's in-memory surface rather than
 * a registry read or a persisted-log fold.
 *
 * A skill being *available* and a skill being *in the context right now* are
 * different facts, and only the second one answers "why doesn't the agent know
 * this". The live `Session` maintains its surface incrementally (each event
 * carries its own `surfaceOp` marker), so membership in `session.surface.nodes`
 * is exactly "the model sees this on the next request" — an O(1) read with no
 * cloning, no replay validation, and no cross-read race retry.
 *
 * Two mechanisms separate *loaded once* from *visible now*:
 *
 *   tool-result pruning   an over-long result is replaced by a head+marker+tail
 *                         stub ON the surface — the model sees the skill
 *                         partially (`pruned`)
 *   compaction            a span of surface nodes is replaced by one summary —
 *                         the skill's content is gone from the model's view
 *                         while its load record stays in the log (`evicted`)
 *
 * The original events always remain in the durable log; these states describe
 * the model's CURRENT view, not the archive.
 */
export type SkillLoadState =
  /** No load record anywhere in the log. */
  | 'unloaded'
  /** Load record present and its full content is on the surface. */
  | 'loaded'
  /** On the surface, but middle-truncated by the tool-result pruner. */
  | 'pruned'
  /** Load record present but compaction shadowed it entirely. */
  | 'evicted';

export interface SkillEntry {
  readonly name: string;
  readonly description?: string;
  readonly state: SkillLoadState;
  /**
   * Whether this skill is exposed to the model on the next step. The panel can
   * turn one skill off for the current session; doing so changes future prompt
   * assembly only — durable conversation events and already-loaded instructions
   * are kept (see the panel's toggle contract).
   */
  readonly enabled: boolean;
  /**
   * How many times this skill was loaded, counting shadowed records. A skill
   * reloaded after an eviction reads `loaded` with `loadCount > 1`.
   */
  readonly loadCount: number;
}

/** One tool in a listing: full wire name, short display label, description. */
export interface ToolEntry {
  readonly name: string;
  readonly label: string;
  readonly description?: string;
  /**
   * Whether this tool is visible on the next step. System tools carry a switch
   * with the same future-only, history-preserving semantics as skills — except
   * `run_code`, which the restriction protocol reserves and never can mask.
   */
  readonly enabled: boolean;
  /** True only for names the tools registry forbids in restrictions. */
  readonly reserved?: boolean;
}

export interface McpToolEntry extends ToolEntry {
  /** False when this exact tool OR its whole server is disabled. */
  readonly enabled: boolean;
}

export interface McpServerEntry {
  readonly server: string;
  readonly tools: readonly McpToolEntry[];
  /**
   * Whether this server's tools are visible on the next step. Same
   * future-only, history-preserving semantics as SkillEntry.enabled.
   */
  readonly enabled: boolean;
}

export interface InspectorPayload {
  readonly sessionId: string | null;
  readonly skills: readonly SkillEntry[];
  readonly mcp: readonly McpServerEntry[];
  /**
   * Non-MCP global tools (the harness's own built-ins), each with its own
   * session-scoped switch.
   */
  readonly systemTools: readonly ToolEntry[];
  /**
   * Post-disable blocked-attempt counts keyed by capability name (skill name
   * or full MCP tool name), aggregated from the plugin's JSONL stats log. A
   * nonzero count means the agent still tried the capability after the user
   * turned it off — the signal for whether the toggle needs a stronger
   * context story.
   */
  readonly blocked: Record<string, number>;
  /**
   * Present only when a read failed. The panel shows partial data plus this
   * note instead of an empty list, because "no skills" and "could not read
   * skills" must not look the same.
   */
  readonly degraded?: readonly string[];
}
