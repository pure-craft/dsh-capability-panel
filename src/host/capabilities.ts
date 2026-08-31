import { classifyBlockedCall, GUARD_DENIAL_PREFIX } from '../stats.js';
import type { StatsRecord } from '../stats.js';
import { HttpError } from './errors.js';
import type {
  AgentLike,
  CapabilityKind,
  HostServices,
  ScopedSkillsRegistry,
  ScopedSystemPrompt,
  ScopedToolsRegistry,
  SessionCapabilityState,
} from './types.js';

export interface CapabilityController {
  readonly states: ReadonlyMap<string, SessionCapabilityState>;
  state(sessionId: string): SessionCapabilityState | undefined;
  set(sessionId: string, kind: CapabilityKind, name: string, enabled: boolean): Promise<void>;
}

function renderDisabledNote(state: SessionCapabilityState): string {
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
}

export function createCapabilityController(
  ctx: HostServices,
  appendStats: (record: StatsRecord) => void,
  blockedCounts: Record<string, number>,
): CapabilityController {
  const states = new Map<string, SessionCapabilityState>();
  const stateFor = (sessionId: string): SessionCapabilityState => {
    let state = states.get(sessionId);
    if (state === undefined) {
      state = { skills: new Map(), mcpServers: new Map(), mcpTools: new Map(), systemTools: new Map() };
      states.set(sessionId, state);
    }
    return state;
  };
  const disabledToolNames = (state: SessionCapabilityState): Set<string> => {
    const names = new Set([...state.mcpTools.keys(), ...state.systemTools.keys()]);
    for (const schema of state.mcpServers.size > 0 ? (ctx.get('tools')?.schemas() ?? []) : []) {
      if (typeof schema.name !== 'string' || !schema.name.startsWith('mcp__')) continue;
      const server = schema.name.slice('mcp__'.length, schema.name.indexOf('__', 'mcp__'.length));
      if (state.mcpServers.has(server)) names.add(schema.name);
    }
    return names;
  };

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next();
    const sessionId = typeof context.agent?.id === 'string' ? context.agent.id : null;
    const state = sessionId === null ? undefined : states.get(sessionId);
    if (state === undefined || state.systemTools.size === 0 || assembled.tools === undefined) return assembled;
    return { ...assembled, tools: assembled.tools.filter((tool) => !state.systemTools.has(String(tool.name))) };
  });

  let guardRegistered = false;
  const ensureGuard = (): void => {
    if (guardRegistered) return;
    const guardDispose = ctx.get('tools')?.guard?.((execution) => {
      const sessionId = typeof execution.agent?.id === 'string' ? execution.agent.id : null;
      const state = sessionId === null ? undefined : states.get(sessionId);
      const name = typeof execution.name === 'string' ? execution.name : null;
      if (state === undefined || name === null || !state.systemTools.has(name)) return undefined;
      return `${GUARD_DENIAL_PREFIX} "${name}" (re-enable from the agent toolkit panel)`;
    });
    if (guardDispose === undefined) return;
    guardRegistered = true;
    ctx.effect(() => guardDispose, 'agent-toolkit: tool guard');
  };
  ensureGuard();

  ctx.on('tools/result', (exec, result) => {
    const agent = exec.agent;
    if (agent === undefined || typeof agent.id !== 'string') return;
    const state = states.get(agent.id);
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
    appendStats({ ts: new Date().toISOString(), sessionId: agent.id, kind: hit.kind, name: hit.name });
  });

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

  const getAgentTools = (sessionId: string): { agent: AgentLike; tools: ScopedToolsRegistry } => {
    const agent = ctx.get('agents')?.get(sessionId);
    const tools = agent?.ctx?.get('tools') as ScopedToolsRegistry | undefined;
    if (agent === undefined) throw new HttpError(404, 'session agent is not available');
    if (tools === undefined) throw new HttpError(503, 'session tools service is not available');
    return { agent, tools };
  };

  const setSkill = async (sessionId: string, name: string, enabled: boolean): Promise<void> => {
    const state = stateFor(sessionId);
    const existing = state.skills.get(name);
    if (enabled && existing !== undefined) {
      existing();
      state.skills.delete(name);
      return;
    }
    const agent = ctx.get('agents')?.get(sessionId);
    const scopedSkills = agent?.ctx?.get('skills') as ScopedSkillsRegistry | undefined;
    if (agent === undefined || scopedSkills === undefined) {
      throw new HttpError(agent === undefined ? 404 : 503, agent === undefined ? 'session agent is not available' : 'session skills service is not available');
    }
    if (enabled || existing !== undefined) return;
    const skills = ctx.get('skills');
    if (skills === undefined) throw new HttpError(503, 'skills service unavailable');
    const cwd = agent.session?.header?.cwd;
    const original = await skills.get(name, { ...(cwd === undefined ? {} : { cwd }), scope: agent });
    if (original === undefined || typeof original.name !== 'string' || typeof original.description !== 'string' || typeof original.content !== 'string') {
      throw new HttpError(404, `skill "${name}" is not available in this session`);
    }
    state.skills.set(name, scopedSkills.register({
      name: original.name,
      description: original.description,
      content: original.content,
      source: 'custom',
      provider: 'agent-toolkit',
      ...(original.resourceBase === undefined ? {} : { resourceBase: original.resourceBase }),
      invocation: { modelInvocable: false, userInvocable: true },
    }));
    ensurePromptNote(agent, state);
  };

  const setServer = (sessionId: string, server: string, enabled: boolean): void => {
    const state = stateFor(sessionId);
    const existing = state.mcpServers.get(server);
    if (enabled && existing !== undefined) {
      existing();
      state.mcpServers.delete(server);
      return;
    }
    const { agent, tools } = getAgentTools(sessionId);
    if (enabled || existing !== undefined) return;
    const toolService = ctx.get('tools');
    if (toolService === undefined) throw new HttpError(503, 'tools service unavailable');
    const prefix = `mcp__${server}__`;
    const names = [...toolService.schemas()]
      .map((schema) => schema.name)
      .filter((name): name is string => typeof name === 'string' && name.startsWith(prefix));
    if (names.length === 0) throw new HttpError(404, `MCP server "${server}" exposes no tools`);
    state.mcpServers.set(server, tools.restrict({ deny: names }));
    ensurePromptNote(agent, state);
  };

  const setTool = (sessionId: string, name: string, enabled: boolean, system: boolean): void => {
    const state = stateFor(sessionId);
    const map = system ? state.systemTools : state.mcpTools;
    const existing = map.get(name);
    if (enabled && existing !== undefined) {
      existing();
      map.delete(name);
      return;
    }
    if (system && name === 'run_code') {
      throw new HttpError(409, 'run_code is the reserved Code Mode transport and cannot be restricted');
    }
    const { agent, tools } = getAgentTools(sessionId);
    if (enabled || existing !== undefined) return;
    const toolService = ctx.get('tools');
    if (toolService === undefined) throw new HttpError(503, 'tools service unavailable');
    const globalNames = new Set(
      [...toolService.schemas()]
        .map((schema) => schema.name)
        .filter((entry): entry is string => typeof entry === 'string'),
    );
    const scopedNames = system
      ? new Set(
          [...toolService.schemas(agent)]
            .map((schema) => schema.name)
            .filter((entry): entry is string => typeof entry === 'string'),
        )
      : globalNames;
    const exists = system ? scopedNames.has(name) : globalNames.has(name) && name.startsWith('mcp__');
    if (!exists) {
      throw new HttpError(404, `${system ? 'system tool' : 'MCP tool'} "${name}" is not available in this session`);
    }
    if (system) ensureGuard();
    map.set(name, globalNames.has(name) ? tools.restrict({ deny: [name] }) : () => {});
    ensurePromptNote(agent, state);
  };

  ctx.effect(() => () => {
    for (const state of states.values()) {
      for (const map of [state.skills, state.mcpServers, state.mcpTools, state.systemTools]) {
        for (const dispose of map.values()) dispose();
      }
      state.noteDispose?.();
    }
    states.clear();
  }, 'agent-toolkit: capability masks');

  return {
    states,
    state: (sessionId) => states.get(sessionId),
    async set(sessionId, kind, name, enabled) {
      if (kind === 'skill') await setSkill(sessionId, name, enabled);
      else if (kind === 'mcp-server') setServer(sessionId, name, enabled);
      else setTool(sessionId, name, enabled, kind === 'system-tool');
      appendStats({ ts: new Date().toISOString(), sessionId, kind: enabled ? 'enable' : 'disable', name: `${kind}:${name}` });
    },
  };
}
