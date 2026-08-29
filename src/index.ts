import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { IncomingLike as BaseIncomingLike } from './loopback.js';
import { isLoopback } from './loopback.js';
import type { InspectorPayload, McpServerEntry, McpToolEntry, SkillEntry, ToolEntry } from './contract.js';
import { collectLoadRecords, decideStates, groupMcpTools, indexToolResultSeqs, shadowedLoadSeqs } from './load-state.js';
import type { EventSurfaceRecord, RawEvent } from './load-state.js';
import { aggregateBlocked, classifyBlockedCall, GUARD_DENIAL_PREFIX } from './stats.js';
import type { StatsRecord } from './stats.js';

/**
 * Host half: one JSON route the browser fetches.
 *
 * Why a route instead of a Typert RPC: the gateway serves generated
 * `InvocationDescriptor` contracts and `$mount()` rejects a descriptor without a
 * strict generated codec, so adding an RPC means entering the codegen pipeline.
 * `webServer.register()` needs none of that, and it is the path
 * `a903067276-rgb/dsh-hud` (MIT) already proved on this exact harness version.
 */

const ROUTE = '/api/agent-toolkit';

type CapabilityKind = 'skill' | 'mcp-server' | 'mcp-tool' | 'system-tool';

/**
 * Per-session, per-item masks. Skill entries hold the disposer of an
 * agent-scoped shadow registration (same name, modelInvocable: false); MCP
 * entries hold disposers of agent-scoped tools restrictions — one per server
 * or per single tool. noteDispose owns the agent-scoped prompt context that
 * tells the model what the user turned off (evaluated per assembly, so it
 * always reflects the live maps).
 */
interface SessionCapabilityState {
  readonly skills: Map<string, () => void>;
  readonly mcpServers: Map<string, () => void>;
  readonly mcpTools: Map<string, () => void>;
  readonly systemTools: Map<string, () => void>;
  noteDispose?: () => void;
}

interface AgentsService {
  get(sessionId: string): AgentLike | undefined;
}

interface SkillsService {
  list(lookup: { cwd?: string; scope?: unknown }): Promise<readonly SkillSummary[]>;
  get(name: string, lookup: { cwd?: string; scope?: unknown }): Promise<SkillDefinitionLike | undefined>;
}

interface ToolsService {
  schemas(scope?: unknown): Iterable<{ name?: unknown; description?: unknown }>;
  /**
   * A synchronous execution guard; returning a string denies that call.
   * Registering at the host level covers every agent, and the guard itself
   * matches on the exact agent id.
   */
  guard?(guard: (execution: { name?: unknown; agent?: { id?: unknown } }) => string | undefined): () => void;
}

interface SessionQueryService {
  /**
   * Full raw log, replay-validated; events keep `data` (arguments, message).
   * Typed `unknown` on purpose: this interface is hand-written, and the last
   * hand-written version of it lied (a guessed `{ events }` wrapper that
   * listEvents never had). The boundary validates the real shape and reports
   * `degraded` instead of trusting the type.
   */
  readSession(sessionId: string): Promise<{ readonly events?: unknown }>;
  /** Light per-event records — the fold verdicts only; NO data payload. */
  listEvents(sessionId: string): Promise<unknown>;
}

interface HostServices {
  readonly webServer?: {
    register(spec: {
      kind: 'prefix';
      path: string;
      handler: (req: IncomingLike, res: ServerResponseLike) => Promise<void> | void;
    }): () => void;
  };
  /**
   * Optional services are read through ctx.get, NOT declared in `inject`: a
   * missing service must degrade one panel section (named in the payload's
   * `degraded` list), never hold the whole plugin in Cordis's waiting state.
   * Reads happen per request/call rather than once at apply(), so a service
   * that appears after boot is picked up on the next poll.
   */
  get(name: 'agents'): AgentsService | undefined;
  get(name: 'skills'): SkillsService | undefined;
  get(name: 'tools'): ToolsService | undefined;
  get(name: 'sessionQuery'): SessionQueryService | undefined;
  /** Scoped event verb; a host-level listener observes every agent. */
  on(
    event: 'tools/result',
    listener: (
      exec: { name?: unknown; arguments?: unknown; agent?: { id?: unknown } },
      result: { isError: boolean; error?: { message?: unknown; info?: { code?: unknown } } },
    ) => void,
  ): void;
  on(
    event: 'system-prompt/assemble',
    listener: (
      assembly: { tools?: readonly { name?: unknown }[] },
      context: { agent?: { id?: unknown } },
      next: () => Promise<{ tools?: readonly { name?: unknown }[] }>,
    ) => Promise<{ tools?: readonly { name?: unknown }[] }>,
  ): void;
  effect(factory: () => (() => void) | void, label?: string): void;
}

/** The skills registry as ONE agent sees it (via agent.ctx.get). */
interface ScopedSkillsRegistry {
  register(skill: {
    name: string;
    description: string;
    content: string;
    source: string;
    provider?: string;
    resourceBase?: unknown;
    invocation?: { modelInvocable: boolean; userInvocable: boolean };
  }): () => void;
}

/** The system-prompt registry as ONE agent sees it. */
interface ScopedSystemPrompt {
  context(context: { name: string; order: number; text: () => string }): () => void;
}

interface AgentLike {
  readonly session?: { readonly header?: { readonly cwd?: string } };
  readonly ctx?: {
    /**
     * The sanctioned optional-service channel. IMPORTANT: property access
     * (agent.ctx.skills) trips the Cordis Guard ("cannot get property without
     * inject") from an outside fiber, while ctx.get() does not — verified live
     * (probe, 2026-08-27): get('skills'/'tools'/'systemPrompt') all return the
     * agent-scoped binding.
     */
    get(name: string): unknown;
  };
}

interface SkillSummary {
  readonly name?: unknown;
  readonly description?: unknown;
  readonly invocation?: { readonly modelInvocable?: unknown };
}

/** Loaded definition of one skill, read before shadowing it for a session. */
interface SkillDefinitionLike {
  readonly name?: unknown;
  readonly description?: unknown;
  readonly content?: unknown;
  readonly resourceBase?: unknown;
}

interface IncomingLike extends BaseIncomingLike {
  on?(event: 'data', listener: (chunk: unknown) => void): void;
  on?(event: 'end', listener: () => void): void;
  on?(event: 'error', listener: (error: unknown) => void): void;
}

interface ServerResponseLike {
  writeHead(status: number, headers: Record<string, string>): void;
  end(body?: string): void;
}

/**
 * The skills this agent could load, as the MODEL sees them.
 *
 * `modelInvocable: false` skills are excluded: their only entry point is a human
 * typing `/name`, so listing them beside model-facing entries would misreport
 * what the agent can reach on its own. The exception is a name in
 * `disabledSkills`: that shadow is OURS (the panel turned it off), and the row
 * must stay visible so the user can turn it back on.
 */
async function readAvailable(
  services: HostServices,
  sessionId: string,
  degraded: string[],
  disabledSkills: ReadonlySet<string>,
): Promise<{ name: string; description?: string }[]> {
  const skills = services.get('skills');
  if (skills === undefined) {
    degraded.push('skills service unavailable');
    return [];
  }
  try {
    const agent = services.get('agents')?.get(sessionId);
    const cwd = agent?.session?.header?.cwd;
    // `scope: agent` is what resolves the agent's own view rather than a global
    // registry dump — without it a preset's private skills are missed.
    const list = await skills.list({ ...(cwd === undefined ? {} : { cwd }), scope: agent });
    const out: { name: string; description?: string }[] = [];
    for (const item of list) {
      if (typeof item.name !== 'string' || item.name === '') continue;
      if (item.invocation?.modelInvocable === false && !disabledSkills.has(item.name)) continue;
      const description = typeof item.description === 'string' ? item.description : undefined;
      out.push({ name: item.name, ...(description === undefined ? {} : { description }) });
    }
    return out;
  } catch (error) {
    degraded.push(`skills read failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * Strict shape checks at the service boundary. A wrong contract guess must
 * land in `degraded`, never silently default to an empty list — that `?? []`
 * default is exactly how the guessed `{ events }` wrapper hid a total failure
 * behind a clean-looking payload.
 */
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

/**
 * The two facts the panel needs, from the two reads that actually carry them.
 *
 * `readSession` returns the full raw log (events keep `data` — arguments and
 * the result pairing at message.source.callId); `listEvents` returns light
 * records whose only payload is the fold verdict (`surface`). Neither alone
 * suffices: the raw log has no verdicts, the records have no arguments. Each
 * rides its own corpus load, so a session writing between the two reads could
 * straddle a compaction — guarded by comparing the last seq of the two cuts,
 * with one retry before reporting degraded.
 */
async function readLogFacts(
  services: HostServices,
  sessionId: string,
  degraded: string[],
): Promise<{ loads: ReturnType<typeof collectLoadRecords>; shadowed: Set<number> }> {
  const query = services.get('sessionQuery');
  if (query === undefined) {
    // Without the fold there is no honest way to tell `loaded` from `evicted`.
    degraded.push('sessionQuery unavailable: eviction state cannot be determined');
    return { loads: [], shadowed: new Set() };
  }
  try {
    // Read the two cuts and compare their last seq: a session writing between
    // the reads yields a mismatched pair. One retry absorbs a single in-flight
    // write; a still-moving log is reported degraded rather than presented as
    // a clean read. The loop always returns — `while` is the shape that lets
    // TS see there is no fall-through, so no unreachable post-loop guard.
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
      const shadowed = shadowedLoadSeqs(loads, indexToolResultSeqs(rawEvents), surfaceBySeq);
      return { loads, shadowed };
    }
  } catch (error) {
    degraded.push(`event read failed: ${error instanceof Error ? error.message : String(error)}`);
    return { loads: [], shadowed: new Set() };
  }
}

function readMcp(
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
    // The GLOBAL view: a server or tool the panel disabled for one session is
    // hidden from that agent's scoped schemas, but the row must stay listed so
    // the user can turn it back on.
    for (const schema of tools.schemas()) {
      if (typeof schema.name !== 'string') continue;
      names.push(schema.name);
      if (typeof schema.description === 'string' && schema.description !== '') {
        descriptions.set(schema.name, schema.description);
      }
    }
    return groupMcpTools(names).map((group) => {
      const serverEnabled = !disabledServers.has(group.server);
      const entries: McpToolEntry[] = group.tools.map((tool) => {
        const fullName = `mcp__${group.server}__${tool}`;
        const description = descriptions.get(fullName);
        return {
          name: fullName,
          label: tool,
          ...(description === undefined ? {} : { description }),
          enabled: serverEnabled && !disabledTools.has(fullName),
        };
      });
      return { server: group.server, tools: entries, enabled: serverEnabled };
    });
  } catch (error) {
    degraded.push(`tool read failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * Non-MCP tools the session's agent can see: the union of the GLOBAL view and
 * the agent's SCOPED view. The global view alone misses preset-layer tools
 * (bash, read, write…), which is most of what "system tools" means to a user.
 * Every entry is toggleable: global names go through restrict(), preset-layer
 * names through the assemble waterfall + guard registered in apply().
 */
function readSystemTools(
  services: HostServices,
  degraded: string[],
  disabledTools: ReadonlySet<string>,
  agent?: AgentLike,
): ToolEntry[] {
  const tools = services.get('tools');
  if (tools === undefined) return [];
  try {
    const byName = new Map<string, ToolEntry>();
    const collect = (scope: AgentLike | undefined): void => {
      for (const schema of tools.schemas(scope)) {
        if (typeof schema.name !== 'string' || schema.name.startsWith('mcp__')) continue;
        if (byName.has(schema.name)) continue;
        const description = typeof schema.description === 'string' && schema.description !== '' ? schema.description : undefined;
        byName.set(schema.name, {
          name: schema.name,
          label: schema.name,
          ...(description === undefined ? {} : { description }),
          enabled: !disabledTools.has(schema.name),
          ...(schema.name === 'run_code' ? { reserved: true } : {}),
        });
      }
    };
    collect(undefined);
    // The scoped view no longer lists tools this session disabled; merge by
    // name so a disabled row stays visible and can be turned back on.
    if (agent !== undefined) collect(agent);
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    degraded.push(`tool read failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

const EMPTY_STATE: SessionCapabilityState = {
  skills: new Map(),
  mcpServers: new Map(),
  mcpTools: new Map(),
  systemTools: new Map(),
};

async function buildPayload(
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

  // Skills catalog and log facts are independent services, so they run
  // together. Within readLogFacts the raw log and the fold verdicts come from
  // two corpus reads whose cuts are reconciled by last-seq comparison.
  const [available, logFacts] = await Promise.all([
    readAvailable(services, sessionId, degraded, disabledSkills),
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

function readRequestBody(req: IncomingLike): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (req.on === undefined) {
      reject(new Error('request body stream unavailable'));
      return;
    }
    let body = '';
    // Once settled (oversize, parse failure, stream error) later events must
    // not keep accumulating into `body` or resolve over the rejection.
    let settled = false;
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    req.on('data', (chunk) => {
      if (settled) return;
      body += String(chunk);
      if (body.length > 16_384) fail(new Error('request body too large'));
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        resolve(body === '' ? {} : JSON.parse(body));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', fail);
  });
}

export function apply(ctx: HostServices): void {
  const webServer = ctx.webServer;
  if (webServer === undefined) return;

  // Session-local, per-item runtime masks. They are deliberately process-local
  // rather than durable events: reopening a restored session starts from the
  // preset's normal capabilities, while the conversation history itself is
  // untouched.
  const capabilityStates = new Map<string, SessionCapabilityState>();
  const stateFor = (sessionId: string): SessionCapabilityState => {
    let state = capabilityStates.get(sessionId);
    if (state === undefined) {
      state = { skills: new Map(), mcpServers: new Map(), mcpTools: new Map(), systemTools: new Map() };
      capabilityStates.set(sessionId, state);
    }
    return state;
  };

  // ---- Stats: does the agent still reach for a capability after it was
  // turned off? JSONL append-only log plus an in-memory aggregate seeded from
  // the log at startup, so counts survive restarts. I/O failure must never
  // break the toggle path — stats are observability, not control flow.
  const statsFile = join(process.env['DSH_HOME'] ?? homedir(), 'agent-toolkit', 'stats.jsonl');
  let blockedCounts: Record<string, number> = {};
  try {
    blockedCounts = aggregateBlocked(readFileSync(statsFile, 'utf8').split('\n'));
  } catch {
    // No log yet.
  }
  const appendStats = (record: StatsRecord): void => {
    try {
      mkdirSync(dirname(statsFile), { recursive: true });
      appendFileSync(statsFile, `${JSON.stringify(record)}\n`);
    } catch {
      // Observability must not break the route.
    }
  };

  /**
   * Every tool name currently masked for a session: single-tool masks (MCP and
   * system), plus the expansion of server masks over that server's tools
   * (from the global view, since the scoped view no longer lists them).
   */
  const disabledToolNames = (state: SessionCapabilityState): Set<string> => {
    const names = new Set([...state.mcpTools.keys(), ...state.systemTools.keys()]);
    if (state.mcpServers.size > 0) {
      for (const schema of ctx.get('tools')?.schemas() ?? []) {
        if (typeof schema.name !== 'string' || !schema.name.startsWith('mcp__')) continue;
        const server = schema.name.slice('mcp__'.length, schema.name.indexOf('__', 'mcp__'.length));
        if (state.mcpServers.has(server)) names.add(schema.name);
      }
    }
    return names;
  };

  /**
   * How a preset-level system tool gets switched off — `restrict` cannot mask
   * these, so two mechanisms cover the two ways the model can reach a tool:
   *
   * 1. the assemble waterfall drops the disabled tool's schema from every
   *    system-prompt assembly for that session, so from the next step the model
   *    neither sees it nor spends context on its schema;
   * 2. `tools.guard` backstops the execution layer: a model calling it from
   *    memory is denied, and the denial text carries a stable prefix the
   *    blocked-attempt stats recognise.
   *
   * Both register at the host level and match the exact agent id, so no other
   * session is touched.
   */
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const assembled = await next();
    const sessionId = typeof context.agent?.id === 'string' ? context.agent.id : null;
    if (sessionId === null) return assembled;
    const state = capabilityStates.get(sessionId);
    if (state === undefined || state.systemTools.size === 0 || assembled.tools === undefined) return assembled;
    return { ...assembled, tools: assembled.tools.filter((tool) => !state.systemTools.has(String(tool.name))) };
  });

  const guardDispose = ctx.get('tools')?.guard?.((execution) => {
    const sessionId = typeof execution.agent?.id === 'string' ? execution.agent.id : null;
    if (sessionId === null) return undefined;
    const state = capabilityStates.get(sessionId);
    if (state === undefined) return undefined;
    const name = typeof execution.name === 'string' ? execution.name : null;
    if (name === null || !state.systemTools.has(name)) return undefined;
    return `${GUARD_DENIAL_PREFIX} "${name}" (re-enable from the agent toolkit panel)`;
  });
  if (guardDispose !== undefined) {
    ctx.effect(() => guardDispose, 'agent-toolkit: tool guard');
  }

  ctx.on('tools/result', (exec, result) => {
    // Narrow the agent once: the guaranteed-present reference below feeds both
    // the state lookup and the classify call (exactOptionalPropertyTypes
    // refuses a maybe-undefined value in an optional property).
    const agent = exec.agent;
    if (agent === undefined || typeof agent.id !== 'string') return;
    const sessionId = agent.id;
    const state = capabilityStates.get(sessionId);
    if (state === undefined) return;
    const hit = classifyBlockedCall(
      {
        name: exec.name,
        arguments: exec.arguments,
        agent,
        ...(result.isError && result.error !== undefined ? { error: result.error } : {}),
      },
      new Set(state.skills.keys()),
      disabledToolNames(state),
    );
    if (hit === null) return;
    blockedCounts[hit.name] = (blockedCounts[hit.name] ?? 0) + 1;
    appendStats({ ts: new Date().toISOString(), sessionId, kind: hit.kind, name: hit.name });
  });

  /**
   * Tell the model what the user turned off, in the voice of an approval
   * denial ("this was the user's choice; here is how to respond"). Registered
   * once per agent as a prompt CONTEXT: re-evaluated at every assembly, so it
   * tracks the live maps exactly and disappears when everything is back on —
   * no durable messages, no toggle noise in the log, immune to compaction.
   */
  const renderDisabledNote = (state: SessionCapabilityState): string => {
    const lines: string[] = [];
    if (state.skills.size > 0) lines.push(`- Skills: ${[...state.skills.keys()].join(', ')}`);
    if (state.mcpServers.size > 0) lines.push(`- MCP servers: ${[...state.mcpServers.keys()].join(', ')}`);
    if (state.mcpTools.size > 0) lines.push(`- MCP tools: ${[...state.mcpTools.keys()].join(', ')}`);
    if (state.systemTools.size > 0) lines.push(`- System tools: ${[...state.systemTools.keys()].join(', ')}`);
    if (lines.length === 0) return '';
    return [
      'The user has turned off the following capabilities for this session:',
      ...lines,
      'Do not attempt to call them. If the user\'s request depends on one, say it is disabled and can be re-enabled from the agent toolkit panel.',
    ].join('\n');
  };
  const ensurePromptNote = (agent: AgentLike, state: SessionCapabilityState): void => {
    if (state.noteDispose !== undefined) return;
    const systemPrompt = agent.ctx?.get('systemPrompt') as ScopedSystemPrompt | undefined;
    if (systemPrompt === undefined) return;
    state.noteDispose = systemPrompt.context({
      name: 'agent-toolkit:disabled-capabilities',
      order: 900,
      text: () => renderDisabledNote(state),
    });
  };

  ctx.effect(
    () => () => {
      for (const state of capabilityStates.values()) {
        for (const dispose of state.skills.values()) dispose();
        for (const dispose of state.mcpServers.values()) dispose();
        for (const dispose of state.mcpTools.values()) dispose();
        for (const dispose of state.systemTools.values()) dispose();
        state.noteDispose?.();
      }
      capabilityStates.clear();
    },
    'agent-toolkit: capability masks',
  );

  /**
   * Turn ONE skill off for ONE session: register a same-name shadow in the
   * agent's own scope layer with `modelInvocable: false`. The layered registry
   * lets the nearest scope win the name, so the model-facing catalog and the
   * `skill` loader both stop offering it, while `/name` user invocation stays
   * available. Re-enabling disposes the shadow and the original wins again.
   */
  const setSkillEnabled = async (sessionId: string, name: string, enabled: boolean): Promise<void> => {
    const agent = ctx.get('agents')?.get(sessionId);
    const scopedSkills = agent?.ctx?.get('skills') as ScopedSkillsRegistry | undefined;
    if (agent === undefined || scopedSkills === undefined) throw new Error('session agent is not available');
    const state = stateFor(sessionId);
    const existing = state.skills.get(name);
    if (enabled) {
      existing?.();
      state.skills.delete(name);
      return;
    }
    if (existing !== undefined) return;
    const skills = ctx.get('skills');
    if (skills === undefined) throw new Error('skills service unavailable');
    const cwd = agent.session?.header?.cwd;
    const lookup = { ...(cwd === undefined ? {} : { cwd }), scope: agent };
    const original = await skills.get(name, lookup);
    if (
      original === undefined ||
      typeof original.name !== 'string' ||
      typeof original.description !== 'string' ||
      typeof original.content !== 'string'
    ) {
      throw new Error(`skill "${name}" is not available in this session`);
    }
    const dispose = scopedSkills.register({
      name: original.name,
      description: original.description,
      content: original.content,
      source: 'custom',
      provider: 'agent-toolkit',
      ...(original.resourceBase === undefined ? {} : { resourceBase: original.resourceBase }),
      invocation: { modelInvocable: false, userInvocable: true },
    });
    state.skills.set(name, dispose);
    ensurePromptNote(agent, state);
  };

  /** Turn ONE MCP server off for ONE session by denying its tools by name. */
  const setMcpServerEnabled = (sessionId: string, server: string, enabled: boolean): void => {
    const agent = ctx.get('agents')?.get(sessionId);
    const scopedTools = agent?.ctx?.get('tools') as { restrict(filter: { deny: readonly string[] }): () => void } | undefined;
    if (agent === undefined || scopedTools === undefined) throw new Error('session agent is not available');
    const state = stateFor(sessionId);
    const existing = state.mcpServers.get(server);
    if (enabled) {
      existing?.();
      state.mcpServers.delete(server);
      return;
    }
    if (existing !== undefined) return;
    // Names come from the GLOBAL view: the scoped view of a previously
    // restricted agent no longer lists them, but restrict() denies global
    // tools by name.
    const prefix = `mcp__${server}__`;
    const names = [...(ctx.get('tools')?.schemas() ?? [])]
      .map((schema) => schema.name)
      .filter((name): name is string => typeof name === 'string' && name.startsWith(prefix));
    if (names.length === 0) throw new Error(`MCP server "${server}" exposes no tools`);
    state.mcpServers.set(server, scopedTools.restrict({ deny: names }));
    ensurePromptNote(agent, state);
  };

  /** Turn ONE MCP tool off for ONE session. */
  const setMcpToolEnabled = (sessionId: string, name: string, enabled: boolean): void => {
    const agent = ctx.get('agents')?.get(sessionId);
    const scopedTools = agent?.ctx?.get('tools') as { restrict(filter: { deny: readonly string[] }): () => void } | undefined;
    if (agent === undefined || scopedTools === undefined) throw new Error('session agent is not available');
    const state = stateFor(sessionId);
    const existing = state.mcpTools.get(name);
    if (enabled) {
      existing?.();
      state.mcpTools.delete(name);
      return;
    }
    if (existing !== undefined) return;
    state.mcpTools.set(name, scopedTools.restrict({ deny: [name] }));
    ensurePromptNote(agent, state);
  };

  /** Turn ONE system (built-in) tool off for ONE session. */
  const setSystemToolEnabled = (sessionId: string, name: string, enabled: boolean): void => {
    if (name === 'run_code') throw new Error('run_code is the reserved Code Mode transport and cannot be restricted');
    const agent = ctx.get('agents')?.get(sessionId);
    const scopedTools = agent?.ctx?.get('tools') as { restrict(filter: { deny: readonly string[] }): () => void } | undefined;
    if (agent === undefined || scopedTools === undefined) throw new Error('session agent is not available');
    const state = stateFor(sessionId);
    const existing = state.systemTools.get(name);
    if (enabled) {
      existing?.();
      state.systemTools.delete(name);
      return;
    }
    if (existing !== undefined) return;
    // A global name additionally goes through `restrict`, which masks it at the
    // registry level so dispatch reports UNKNOWN_TOOL. A preset-level name is
    // only recorded in `state`: the assemble waterfall and the guard read the
    // live map (registered above), so re-enabling is just deleting the entry.
    const isGlobal = [...(ctx.get('tools')?.schemas() ?? [])].some((schema) => schema.name === name);
    const dispose = isGlobal ? scopedTools.restrict({ deny: [name] }) : () => {};
    state.systemTools.set(name, dispose);
    ensurePromptNote(agent, state);
  };

  const setCapability = async (
    sessionId: string,
    kind: CapabilityKind,
    name: string,
    enabled: boolean,
  ): Promise<void> => {
    if (kind === 'skill') await setSkillEnabled(sessionId, name, enabled);
    else if (kind === 'mcp-server') setMcpServerEnabled(sessionId, name, enabled);
    else if (kind === 'mcp-tool') setMcpToolEnabled(sessionId, name, enabled);
    else setSystemToolEnabled(sessionId, name, enabled);
    appendStats({
      ts: new Date().toISOString(),
      sessionId,
      kind: enabled ? 'enable' : 'disable',
      name: `${kind}:${name}`,
    });
  };

  // The factory MUST be an arrow function: `ctx.effect` invokes what it is given,
  // so passing `webServer.register(...)` directly would register and then hand
  // its own disposer to effect, unregistering the route immediately.
  ctx.effect(
    () =>
      webServer.register({
        kind: 'prefix',
        path: ROUTE,
        handler: async (req, res) => {
          if (!isLoopback(req)) {
            res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('forbidden');
            return;
          }
          try {
            const url = new URL(req.url ?? '/', 'http://dsh.local');

            // The stats log itself, for offline analysis of the toggle
            // experiment: `curl 'http://127.0.0.1:3080/api/agent-toolkit/stats'`.
            if (url.pathname === `${ROUTE}/stats`) {
              let records: StatsRecord[] = [];
              try {
                records = readFileSync(statsFile, 'utf8')
                  .split('\n')
                  .filter((line) => line.trim() !== '')
                  .map((line) => JSON.parse(line) as StatsRecord);
              } catch {
                // No log yet.
              }
              res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ logFile: statsFile, blocked: blockedCounts, records }));
              return;
            }

            const sessionId = url.searchParams.get('session');
            if (req.method === 'POST') {
              // A JSON content-type can only arrive via a non-simple (preflighted)
              // request, which a cross-origin page cannot send to us; a form post
              // (text/plain) is rejected here before the body is even read.
              const contentType = req.headers['content-type'];
              if (typeof contentType !== 'string' || !contentType.startsWith('application/json')) {
                res.writeHead(415, { 'content-type': 'text/plain; charset=utf-8' });
                res.end('expected application/json');
                return;
              }
              if (sessionId === null) throw new Error('session is required');
              const body = await readRequestBody(req);
              if (body === null || typeof body !== 'object') throw new Error('invalid request body');
              const record = body as { kind?: unknown; name?: unknown; enabled?: unknown };
              const KINDS: readonly string[] = ['skill', 'mcp-server', 'mcp-tool', 'system-tool'];
              if (typeof record.kind !== 'string' || !KINDS.includes(record.kind) || typeof record.enabled !== 'boolean') {
                throw new Error('kind must be skill, mcp-server, mcp-tool or system-tool and enabled must be boolean');
              }
              if (typeof record.name !== 'string' || record.name === '') {
                throw new Error('name is required');
              }
              await setCapability(sessionId, record.kind as CapabilityKind, record.name, record.enabled);
            }
            const payload = await buildPayload(
              ctx,
              sessionId,
              // Read path must not mint: only capability writes create a
              // state entry, so an arbitrary ?session= cannot grow the map.
              sessionId === null ? EMPTY_STATE : (capabilityStates.get(sessionId) ?? EMPTY_STATE),
              blockedCounts,
            );
            res.writeHead(200, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            });
            res.end(JSON.stringify(payload));
          } catch (error) {
            res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
          }
        },
      }),
    'agent-toolkit: data route',
  );
}

// Only the route is a hard dependency. Everything else is read through
// ctx.get so a partial host gets a degraded panel instead of a plugin that
// never starts (see HostServices.get).
export const inject = ['webServer'];
