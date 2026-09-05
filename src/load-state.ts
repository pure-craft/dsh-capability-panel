import type { SkillEntry, SkillLoadState } from './contract.js';

/**
 * One `skill` tool call found in the durable log.
 *
 * Verified against real session logs: a load is a
 * `tool/call` event whose `data.name` is `"skill"` and whose `data.arguments` is
 * a JSON *string* holding `{ name }`. The nested shapes suggested by package
 * READMEs (`data.call.name`, `data.call.args`) do NOT exist here — reading them
 * silently found zero loads in sessions that had five.
 */
export interface SkillLoadRecord {
  readonly seq: number;
  readonly skillName: string;
  readonly callId: string;
}

/** A positional surface replacement, i.e. one compaction or tool-result prune. */
export interface SurfaceReplacement {
  readonly seq: number;
  readonly start: number;
  readonly end: number;
}

/**
 * The raw event shape this package reads, verified against real logs:
 * `surfaceOp` is a TOP-LEVEL field — the string `"append"` for a
 * node that joined the surface tail, an object for a replacement, and `null`
 * on non-surface events like `tool/call`. Reading `data.surfaceOp` instead
 * finds nothing and misreports compacted sessions as never-compacted.
 */
export interface RawEvent {
  readonly type?: string;
  readonly seq?: number;
  readonly surfaceOp?: 'append' | { readonly op?: string; readonly start?: number; readonly end?: number } | null;
  readonly data?: {
    readonly name?: string;
    readonly arguments?: string;
    readonly callId?: string;
    /** tool/result payload; the pairing callId lives at message.source.callId. */
    readonly message?: {
      readonly source?: { readonly callId?: unknown };
      /** Result blocks; read for prune-marker detection on surface nodes. */
      readonly content?: unknown;
    };
  };
}

/** Pull the skill name out of a `skill` tool call's stringified arguments. */
function skillNameOf(args: string | undefined): string | null {
  if (typeof args !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(args);
    if (parsed !== null && typeof parsed === 'object' && 'name' in parsed) {
      const name = (parsed as { name?: unknown }).name;
      return typeof name === 'string' && name !== '' ? name : null;
    }
  } catch {
    // A malformed argument blob is not a load we can attribute; skip it rather
    // than guessing a name.
  }
  return null;
}

export function collectLoadRecords(events: readonly RawEvent[]): SkillLoadRecord[] {
  const out: SkillLoadRecord[] = [];
  for (const event of events) {
    if (event.type !== 'tool/call') continue;
    if (event.data?.name !== 'skill') continue;
    const skillName = skillNameOf(event.data.arguments);
    if (skillName === null) continue;
    const seq = event.seq;
    if (typeof seq !== 'number') continue;
    out.push({ seq, skillName, callId: event.data.callId ?? '' });
  }
  return out;
}

export function collectReplacements(events: readonly RawEvent[]): SurfaceReplacement[] {
  const out: SurfaceReplacement[] = [];
  for (const event of events) {
    const op = event.surfaceOp;
    if (op === null || op === undefined || op === 'append') continue;
    if (op.op !== 'replace') continue;
    const { start, end } = op;
    const seq = event.seq;
    if (typeof seq !== 'number' || typeof start !== 'number' || typeof end !== 'number') continue;
    out.push({ seq, start, end });
  }
  return out;
}

/**
 * Map a tool result's pairing callId to its seq.
 *
 * Verified against real logs: `tool/result` events carry no
 * top-level callId; the pairing lives at `data.message.source.callId` and
 * matches the call's `data.callId` exactly.
 *
 * Last write wins on purpose: the middle-pruner appends a stub `tool/result`
 * carrying the SAME callId and a replace surfaceOp over the original's seq
 * (verified against a real compacted session), so the callId resolves to the
 * stub — the node whose fold verdict actually tracks the surface position.
 */
export function indexToolResultSeqs(events: readonly RawEvent[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const event of events) {
    if (event.type !== 'tool/result') continue;
    const callId = event.data?.message?.source?.callId;
    const seq = event.seq;
    if (typeof callId !== 'string' || callId === '' || typeof seq !== 'number') continue;
    out.set(callId, seq);
  }
  return out;
}

/**
 * The load seqs whose skill content is gone from the model surface.
 *
 * A `tool/call` never joins the surface itself — SURFACE_EVENT_TYPES in
 * dsh-session is exactly { user/message, assistant/message, tool/result }, and
 * real skill calls carry `surfaceOp: null`. What the model actually sees of a
 * skill is its tool RESULT (a surface node), so eviction keys on the paired
 * result's surface membership, not on the call's position.
 *
 * `surfaceSeqs` is the live session's CURRENT surface (`session.surface.nodes`),
 * which the session maintains incrementally — reading it is O(1), no log fold
 * is ever run for this panel. A paired result seq absent from that set was
 * displaced by a prune stub's or a summary's `replace` op, i.e. shadowed.
 *
 * A load with no paired result is in flight or its result never landed; it is
 * NOT counted as shadowed, so it reports `loaded` — the honest reading of "the
 * model is about to see it".
 */
export function shadowedLoadSeqs(
  loads: readonly SkillLoadRecord[],
  resultSeqByCallId: ReadonlyMap<string, number>,
  surfaceSeqs: ReadonlySet<number>,
): Set<number> {
  const out = new Set<number>();
  for (const load of loads) {
    const resultSeq = resultSeqByCallId.get(load.callId);
    if (resultSeq === undefined) continue;
    if (!surfaceSeqs.has(resultSeq)) out.add(load.seq);
  }
  return out;
}

/**
 * Substring of dsh-compaction-tool-result-pruner's PRUNE_MARKER. Matching on
 * the bracketed phrase (without the surrounding newlines) keeps the check
 * robust to marker framing changes across pruner versions.
 */
export const PRUNE_MARKER_TEXT = '[... tool result middle pruned ...]';

function textBlocksOf(event: RawEvent): readonly string[] {
  const content = event.data?.message?.content;
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  // A tool/result message wraps its blocks one level deep: message.content is
  // [{ type: 'tool_result', content: blocks }] on the pruner's write path.
  const walk = (blocks: readonly unknown[]): void => {
    for (const block of blocks) {
      if (block === null || typeof block !== 'object') continue;
      const record = block as { type?: unknown; text?: unknown; content?: unknown };
      if (record.type === 'text' && typeof record.text === 'string') out.push(record.text);
      else if (Array.isArray(record.content)) walk(record.content);
    }
  };
  walk(content);
  return out;
}

/**
 * The load seqs whose paired tool result sits on the surface TRUNCATED —
 * head and tail visible, middle replaced by the pruner's marker. The model
 * partially sees these skills, so they read as their own state rather than
 * either extreme. Only surface-resident results are inspected; a shadowed
 * result is already reported by shadowedLoadSeqs and its content is
 * irrelevant to the model now.
 */
export function prunedLoadSeqs(
  loads: readonly SkillLoadRecord[],
  resultSeqByCallId: ReadonlyMap<string, number>,
  surfaceSeqs: ReadonlySet<number>,
  events: readonly RawEvent[],
): Set<number> {
  const prunedResults = new Set<number>();
  for (const event of events) {
    if (event.type !== 'tool/result') continue;
    const seq = event.seq;
    if (typeof seq !== 'number' || !surfaceSeqs.has(seq)) continue;
    if (textBlocksOf(event).some((text) => text.includes(PRUNE_MARKER_TEXT))) prunedResults.add(seq);
  }
  const out = new Set<number>();
  for (const load of loads) {
    const resultSeq = resultSeqByCallId.get(load.callId);
    if (resultSeq !== undefined && prunedResults.has(resultSeq)) out.add(load.seq);
  }
  return out;
}

/**
 * Decide each skill's state.
 *
 * `shadowedSeqs` holds LOAD seqs whose paired tool result is absent from the
 * current surface (see shadowedLoadSeqs for why the result, not the call,
 * carries the verdict); `prunedSeqs` holds load seqs whose result survives on
 * the surface with its middle truncated. Do NOT re-derive either from
 * replacement ranges here: after a replacement lands, a high-seq summary node
 * sits at the shadowed range's *position*, so surface order stops tracking
 * seq order and a numeric `start <= seq <= end` test silently misjudges later
 * compactions.
 *
 * Verified against real data: the middle-pruner had replaced the lark-shared /
 * lark-im / lark-event results with stubs (those now read `pruned`), and a
 * later full-history compaction (one replace over [7..16114]) shadowed those
 * stubs plus the find-skills / git-worktree-discipline results (those read
 * `evicted`).
 */
export function decideStates(
  available: readonly { name: string; description?: string; masked?: boolean }[],
  loads: readonly SkillLoadRecord[],
  shadowedSeqs: ReadonlySet<number>,
  disabledSkills: ReadonlySet<string> = new Set(),
  prunedSeqs: ReadonlySet<number> = new Set(),
): SkillEntry[] {
  const byName = new Map<string, SkillLoadRecord[]>();
  for (const record of loads) {
    const bucket = byName.get(record.skillName);
    if (bucket === undefined) byName.set(record.skillName, [record]);
    else bucket.push(record);
  }

  return available.map(({ name, description, masked }) => {
    const records = byName.get(name) ?? [];
    let state: SkillLoadState = 'unloaded';
    if (records.length > 0) {
      // A reload after an eviction is still loaded: any surviving record wins.
      const current = records.filter((r) => !shadowedSeqs.has(r.seq));
      if (current.length === 0) state = 'evicted';
      // One fully intact copy in context is enough; truncation shows only
      // when every surviving copy was middle-pruned.
      else state = current.some((r) => !prunedSeqs.has(r.seq)) ? 'loaded' : 'pruned';
    }
    return {
      name,
      ...(description === undefined ? {} : { description }),
      state,
      // Off if THIS panel switched it off, or if something else already
      // withdrew model invocation -- a preset default, most often.
      enabled: !disabledSkills.has(name) && masked !== true,
      loadCount: records.length,
    };
  });
}

/** Group MCP tools by server: `mcp__<server>__<tool>`. */
export function groupMcpTools(toolNames: readonly string[]): { server: string; tools: string[] }[] {
  const byServer = new Map<string, string[]>();
  for (const raw of toolNames) {
    if (!raw.startsWith('mcp__')) continue;
    const rest = raw.slice('mcp__'.length);
    const cut = rest.indexOf('__');
    // A name with no second separator has no tool part to attribute.
    if (cut <= 0) continue;
    const server = rest.slice(0, cut);
    const tool = rest.slice(cut + 2);
    if (tool === '') continue;
    const bucket = byServer.get(server);
    if (bucket === undefined) byServer.set(server, [tool]);
    else bucket.push(tool);
  }
  return [...byServer.entries()]
    .map(([server, tools]) => ({ server, tools: tools.sort() }))
    .sort((a, b) => a.server.localeCompare(b.server));
}
