import type { InspectorPayload, McpServerEntry, McpToolEntry, SkillEntry, ToolEntry } from '../contract.js';
import { collectLoadRecords, decideStates, groupMcpTools, indexToolResultSeqs, prunedLoadSeqs, shadowedLoadSeqs } from '../load-state.js';
import type { RawEvent } from '../load-state.js';
import type { AgentLike, HostServices, SessionCapabilityState } from './types.js';
import { RESERVED_TOOL } from './reserved.js';

// Shared singleton for "no switches on this session". Never mutate it: every
// reader treats the maps as read-only, and a write here would leak into every
// session that has no state of its own.
export const EMPTY_STATE: SessionCapabilityState = {
  skills: new Map(),
  mcpServers: new Map(),
  mcpTools: new Map(),
  systemTools: new Map(),
  userToggled: new Set(),
};

export async function readAvailable(
  services: HostServices,
  sessionId: string,
  degraded: string[],
): Promise<{ name: string; description?: string; masked?: boolean }[]> {
  const skills = services.get('skills');
  if (skills === undefined) {
    degraded.push('skills service unavailable');
    return [];
  }
  try {
    const agents = services.get('agents');
    if (agents === undefined) {
      degraded.push('agents service unavailable: session skill view cannot be determined');
      return [];
    }
    const agent = agents.get(sessionId);
    if (agent === undefined) {
      degraded.push(`session agent "${sessionId}" unavailable: session skill view cannot be determined`);
      return [];
    }
    const cwd = agent.session?.header?.cwd;
    const list = await skills.list({ ...(cwd === undefined ? {} : { cwd }), scope: agent });
    // A masked skill is listed twice: the original entry and the same-name
    // shadow that withdrew model invocation. Both this panel's own switches and
    // the preset panel's produce such a shadow, so a shadow is recorded as
    // "off" rather than skipped -- skipping it made a preset-disabled skill
    // vanish from this panel entirely, leaving the user unable to see it, and
    // unable to switch it back on. Keeping the first entry per name preserves
    // the richer original description.
    const out: { name: string; description?: string; masked?: boolean }[] = [];
    const seen = new Map<string, { name: string; description?: string; masked?: boolean }>();
    for (const item of list) {
      if (typeof item.name !== 'string' || item.name === '') continue;
      const masked = item.invocation?.modelInvocable === false;
      const existing = seen.get(item.name);
      if (existing !== undefined) {
        if (masked) existing.masked = true;
        continue;
      }
      const description = typeof item.description === 'string' ? item.description : undefined;
      const row = {
        name: item.name,
        ...(description === undefined ? {} : { description }),
        ...(masked ? { masked: true } : {}),
      };
      seen.set(item.name, row);
      out.push(row);
    }
    return out;
  } catch (error) {
    degraded.push(`skills read failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * Read load facts off the LIVE session's in-memory log — the same object the
 * agent loop itself reads to assemble the next request.
 *
 * This used to go through `sessionQuery.readSession` + `listEvents`, which are
 * built for cross-session/cold reads: each call structuredClones the ENTIRE
 * event log, `readSession` additionally replay-validates it via Session.create,
 * and a write landing between the two parallel reads forced a whole second
 * round. On a long session (60k events / tens of MB) that meant four full-log
 * clones plus two full replays of synchronous CPU work on every panel open —
 * blocking the Node event loop and freezing the GUI served by the same process.
 *
 * The live session needs none of that: `snapshotEvents()` hands back borrowed
 * references (zero-copy), and `surface.nodes` is maintained incrementally as
 * events land, so "what the model sees right now" is an O(1) membership test.
 * Scanning references for the few `skill` tool calls costs microseconds even
 * on the longest log. Both reads happen in one synchronous tick, so the view
 * is always self-consistent — no cross-read race, no retry loop.
 *
 * A session without a live in-memory view (e.g. restored but not yet attached)
 * degrades honestly instead of paying for a cold-log read the panel never
 * asked for.
 */
export function readLogFacts(
  services: HostServices,
  sessionId: string,
  degraded: string[],
): { loads: ReturnType<typeof collectLoadRecords>; shadowed: Set<number>; pruned: Set<number> } {
  const empty = { loads: [], shadowed: new Set<number>(), pruned: new Set<number>() };
  try {
    const session = services.get('agents')?.get(sessionId)?.session;
    const nodes = session?.surface?.nodes;
    if (session === undefined || typeof session.snapshotEvents !== 'function' || !Array.isArray(nodes)) {
      degraded.push('live session view unavailable: load states cannot be determined');
      return empty;
    }
    // snapshotEvents must stay BOUND to the session: the real Session's
    // signature is snapshotEvents(fromSeq = 0, toSeqExclusive = this.seq),
    // so a detached call crashes on `this.seq`.
    const events = session.snapshotEvents();
    // A wrong shape must surface as degraded, never read as "no loads".
    if (!Array.isArray(events)) {
      degraded.push('snapshotEvents() returned an unexpected shape; cannot read skill loads');
      return empty;
    }
    const surfaceSeqs = new Set<number>();
    for (const seq of nodes) if (typeof seq === 'number') surfaceSeqs.add(seq);
    const loads = collectLoadRecords(events as readonly RawEvent[]);
    const resultSeqs = indexToolResultSeqs(events);
    return {
      loads,
      shadowed: shadowedLoadSeqs(loads, resultSeqs, surfaceSeqs),
      pruned: prunedLoadSeqs(loads, resultSeqs, surfaceSeqs, events),
    };
  } catch (error) {
    degraded.push(`event read failed: ${error instanceof Error ? error.message : String(error)}`);
    return empty;
  }
}

export function readMcp(
  services: HostServices,
  degraded: string[],
  disabledServers: ReadonlySet<string>,
  disabledTools: ReadonlySet<string>,
): McpServerEntry[] {
  const tools = services.get('tools');
  if (tools === undefined) {
    degraded.push('tools service unavailable');
    return [];
  }
  try {
    const names: string[] = [];
    const descriptions = new Map<string, string>();
    for (const schema of tools.schemas()) {
      if (typeof schema.name !== 'string') continue;
      names.push(schema.name);
      if (typeof schema.description === 'string' && schema.description !== '') descriptions.set(schema.name, schema.description);
    }
    return groupMcpTools(names).map((group) => {
      const enabled = !disabledServers.has(group.server);
      const entries: McpToolEntry[] = group.tools.map((tool) => {
        const name = `mcp__${group.server}__${tool}`;
        const description = descriptions.get(name);
        return {
          name,
          label: tool,
          ...(description === undefined ? {} : { description }),
          enabled: enabled && !disabledTools.has(name),
        };
      });
      return { server: group.server, tools: entries, enabled };
    });
  } catch (error) {
    degraded.push(`tool read failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

export function readSystemTools(
  services: HostServices,
  degraded: string[],
  disabledTools: ReadonlySet<string>,
  agent?: AgentLike,
): ToolEntry[] {
  const tools = services.get('tools');
  if (tools === undefined) {
    // Each reader owns its diagnostic, while the combined payload emits it once.
    if (!degraded.includes('tools service unavailable')) degraded.push('tools service unavailable');
    return [];
  }
  try {
    // What the agent can actually call right now. A tool the preset denied is
    // absent here while still present globally, and the panel has to tell
    // those apart: the row stays listed, because the session may switch it
    // back on, but reporting it as enabled would claim the model can reach
    // something it cannot.
    let reachable: Set<string> | undefined;
    if (agent !== undefined) {
      reachable = new Set<string>();
      for (const schema of tools.schemas(agent)) {
        if (typeof schema.name === 'string') reachable.add(schema.name);
      }
    }
    const byName = new Map<string, ToolEntry>();
    const collect = (scope: AgentLike | undefined): void => {
      for (const schema of tools.schemas(scope)) {
        if (typeof schema.name !== 'string' || schema.name.startsWith('mcp__') || byName.has(schema.name)) continue;
        const description = typeof schema.description === 'string' && schema.description !== '' ? schema.description : undefined;
        byName.set(schema.name, {
          name: schema.name,
          label: schema.name,
          ...(description === undefined ? {} : { description }),
          enabled:
            !disabledTools.has(schema.name) && (reachable === undefined || reachable.has(schema.name)),
          ...(schema.name === RESERVED_TOOL ? { reserved: true } : {}),
        });
      }
    };
    collect(undefined);
    if (agent !== undefined) collect(agent);
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    degraded.push(`tool read failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

export async function buildPayload(
  services: HostServices,
  sessionId: string | null,
  capabilityState: SessionCapabilityState = EMPTY_STATE,
  blocked: Record<string, number> = {},
): Promise<InspectorPayload> {
  const degraded: string[] = [];
  const disabledSkills = new Set(capabilityState.skills.keys());
  const disabledServers = new Set(capabilityState.mcpServers.keys());
  const disabledTools = new Set(capabilityState.mcpTools.keys());
  const disabledSystem = new Set(capabilityState.systemTools.keys());
  if (sessionId === null) {
    return {
      sessionId: null,
      skills: [],
      mcp: readMcp(services, degraded, disabledServers, disabledTools),
      systemTools: readSystemTools(services, degraded, disabledSystem),
      blocked,
      ...(degraded.length > 0 ? { degraded } : {}),
    };
  }
  const agent = services.get('agents')?.get(sessionId);
  const available = await readAvailable(services, sessionId, degraded);
  const logFacts = readLogFacts(services, sessionId, degraded);
  const skills: SkillEntry[] = decideStates(available, logFacts.loads, logFacts.shadowed, disabledSkills, logFacts.pruned);
  return {
    sessionId,
    skills,
    mcp: readMcp(services, degraded, disabledServers, disabledTools),
    systemTools: readSystemTools(services, degraded, disabledSystem, agent),
    blocked,
    ...(degraded.length > 0 ? { degraded } : {}),
  };
}
