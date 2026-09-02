import type { InspectorPayload, McpServerEntry, McpToolEntry, SkillEntry, ToolEntry } from '../contract.js';
import { collectLoadRecords, decideStates, groupMcpTools, indexToolResultSeqs, shadowedLoadSeqs } from '../load-state.js';
import type { EventSurfaceRecord, RawEvent } from '../load-state.js';
import type { AgentLike, HostServices, SessionCapabilityState } from './types.js';
import { RESERVED_TOOL } from './reserved.js';

export const EMPTY_STATE: SessionCapabilityState = {
  skills: new Map(),
  mcpServers: new Map(),
  mcpTools: new Map(),
  systemTools: new Map(),
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

function requireEventArray(value: unknown, label: string, degraded: string[]): readonly RawEvent[] | null {
  if (!Array.isArray(value)) {
    degraded.push(`${label} returned an unexpected shape; cannot read skill loads`);
    return null;
  }
  return value as readonly RawEvent[];
}

function toSurfaceRecords(value: unknown, label: string, degraded: string[]): readonly EventSurfaceRecord[] | null {
  if (!Array.isArray(value)) {
    degraded.push(`${label} returned an unexpected shape; cannot read surface verdicts`);
    return null;
  }
  const out: EventSurfaceRecord[] = [];
  for (const item of value as readonly unknown[]) {
    if (item === null || typeof item !== 'object') continue;
    const record = item as { seq?: unknown; surface?: unknown };
    if (typeof record.seq === 'number' && typeof record.surface === 'string') {
      out.push({ seq: record.seq, surface: record.surface });
    }
  }
  if (value.length > 0 && out.length === 0) {
    degraded.push(`${label} records lack seq/surface; cannot read surface verdicts`);
    return null;
  }
  return out;
}

function lastSeq(events: readonly { seq?: number }[]): number | null {
  const last = events.at(-1)?.seq;
  return typeof last === 'number' ? last : null;
}

export async function readLogFacts(
  services: HostServices,
  sessionId: string,
  degraded: string[],
): Promise<{ loads: ReturnType<typeof collectLoadRecords>; shadowed: Set<number> }> {
  const query = services.get('sessionQuery');
  if (query === undefined) {
    degraded.push('sessionQuery unavailable: eviction state cannot be determined');
    return { loads: [], shadowed: new Set() };
  }
  try {
    for (let attempt = 0; ; attempt++) {
      const [raw, listed] = await Promise.all([query.readSession(sessionId), query.listEvents(sessionId)]);
      const rawEvents = requireEventArray(
        raw !== null && typeof raw === 'object' ? (raw as { events?: unknown }).events : undefined,
        'readSession().events',
        degraded,
      );
      const records = toSurfaceRecords(listed, 'listEvents()', degraded);
      if (rawEvents === null || records === null) return { loads: [], shadowed: new Set() };
      const agreed = lastSeq(rawEvents) === lastSeq(records);
      if (!agreed && attempt === 0) continue;
      if (!agreed) degraded.push('session log moved while reading; load states may straddle a write');
      const loads = collectLoadRecords(rawEvents);
      const surfaceBySeq = new Map<number, string>(records.map((record) => [record.seq, record.surface]));
      return { loads, shadowed: shadowedLoadSeqs(loads, indexToolResultSeqs(rawEvents), surfaceBySeq) };
    }
  } catch (error) {
    degraded.push(`event read failed: ${error instanceof Error ? error.message : String(error)}`);
    return { loads: [], shadowed: new Set() };
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
  const [available, logFacts] = await Promise.all([
    readAvailable(services, sessionId, degraded),
    readLogFacts(services, sessionId, degraded),
  ]);
  const skills: SkillEntry[] = decideStates(available, logFacts.loads, logFacts.shadowed, disabledSkills);
  return {
    sessionId,
    skills,
    mcp: readMcp(services, degraded, disabledServers, disabledTools),
    systemTools: readSystemTools(services, degraded, disabledSystem, agent),
    blocked,
    ...(degraded.length > 0 ? { degraded } : {}),
  };
}
