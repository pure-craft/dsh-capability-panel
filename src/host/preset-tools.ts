import { settingsNamespace } from '@deepseek-ai/dsh-settings';
import z from '@deepseek-ai/schemastery';
import { errorMessage, HttpError } from './errors.js';
import type {
  AgentCreatedPayload,
  AgentLike,
  AgentPresetLike,
  AgentPresetsService,
  HostServices,
  PresetMcpServer,
  PresetSkillRow,
  PresetToolEntry,
  PresetToolPayload,
  PresetToolRow,
  PresetToolSettings,
  ScopedSkillsRegistry,
  SettingsScopeLike,
  SkillsService,
  ToolsService,
} from './types.js';
import { groupMcpTools } from '../load-state.js';

export const PRESET_SETTINGS_NAMESPACE = settingsNamespace('agent-toolkit');
export const RESERVED_TOOL = 'run_code';

const PresetToolSettingsSchema = z.object({
  presets: z.dict(z.array(z.string())).default({}),
  presetSkills: z.dict(z.array(z.string())).default({}),
});

function requireService<T>(service: T | undefined, message: string): T {
  if (service === undefined) throw new HttpError(503, message);
  return service;
}

interface ToolSummary {
  readonly name: string;
  readonly description?: string;
}

function toolSummaries(tools: ToolsService, scope: unknown): ToolSummary[] {
  const entries = new Map<string, ToolSummary>();
  for (const schema of tools.schemas(scope)) {
    if (typeof schema.name !== 'string' || schema.name === '' || entries.has(schema.name)) continue;
    entries.set(schema.name, {
      name: schema.name,
      ...(typeof schema.description === 'string' ? { description: schema.description } : {}),
    });
  }
  return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Read the skills one preset can see, marking those that came from the reading
 * process's project root.
 *
 * The panel has no agent and therefore no session cwd, so it reports what THIS
 * workspace would contribute. A project skill is marked rather than dropped:
 * hiding it would silently shorten the list, while marking it says plainly
 * that a session opened elsewhere will not see the row.
 */
async function presetSkillRows(
  skills: SkillsService,
  scope: unknown,
  disabled: ReadonlySet<string>,
  cwd: string,
): Promise<PresetSkillRow[]> {
  const seen = new Map<string, PresetSkillRow>();
  const add = (summaries: readonly { name?: unknown; description?: unknown }[], project: boolean): void => {
    for (const summary of summaries) {
      if (typeof summary.name !== 'string' || summary.name === '' || seen.has(summary.name)) continue;
      const description = typeof summary.description === 'string' ? summary.description : undefined;
      seen.set(summary.name, {
        name: summary.name,
        ...(description === undefined ? {} : { description }),
        enabled: !disabled.has(summary.name),
        ...(project ? { project: true } : {}),
      });
    }
  };
  // Without cwd first: anything the workspace-aware read adds on top of this
  // set is exactly what the project root contributed.
  add(await skills.list({ scope }), false);
  add(await skills.list({ scope, cwd }), true);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function presetAndTools(
  agentPresets: AgentPresetsService,
  tools: ToolsService,
  presetId: string,
): Promise<{ preset: AgentPresetLike; tools: ToolSummary[] }> {
  const presets = await agentPresets.list();
  const preset = presets.find((entry) => entry.id === presetId);
  if (preset === undefined) throw new HttpError(404, `preset "${presetId}" is not available`);
  if (preset.broken !== undefined) throw new HttpError(409, `preset "${presetId}" is broken: ${preset.broken}`);
  try {
    const scope = await agentPresets.standingKeyFor(presetId);
    return { preset, tools: toolSummaries(tools, scope) };
  } catch (error) {
    throw new HttpError(503, `preset "${presetId}" tools are unavailable: ${errorMessage(error)}`);
  }
}

export interface PresetToolController {
  list(): Promise<PresetToolPayload>;
  set(presetId: string, name: string, enabled: boolean): Promise<PresetToolPayload>;
  /** Toggle every tool of one MCP server in a single write. */
  setServer(presetId: string, server: string, enabled: boolean): Promise<PresetToolPayload>;
  setSkill(presetId: string, name: string, enabled: boolean): Promise<PresetToolPayload>;
}

export function createPresetToolController(ctx: HostServices): PresetToolController {
  // Registered on first read, not at apply time: this row does not `inject`
  // settings, so at composition the service may not be published yet. Binding
  // it eagerly would freeze an early `undefined` into a permanent 503 even
  // after settings arrives. The registration is an effect on this fiber, so it
  // is still disposed with the plugin.
  let scope: SettingsScopeLike<PresetToolSettings> | undefined;
  const settingsScope = (): SettingsScopeLike<PresetToolSettings> | undefined => {
    if (scope === undefined) {
      scope = ctx.get('settings')?.register<PresetToolSettings>(
        PRESET_SETTINGS_NAMESPACE,
        PresetToolSettingsSchema,
        { applies: 'live' },
      );
    }
    return scope;
  };

  const services = (): { agentPresets: AgentPresetsService; tools: ToolsService; settings: SettingsScopeLike<PresetToolSettings> } => ({
    agentPresets: requireService(ctx.get('agentPresets'), 'agentPresets service unavailable'),
    tools: requireService(ctx.get('tools'), 'tools service unavailable'),
    settings: requireService(settingsScope(), 'settings service unavailable'),
  });

  const list = async (): Promise<PresetToolPayload> => {
    const { agentPresets, tools, settings: settingsScope } = services();
    const stored = settingsScope.get();
    const configured = stored.presets;
    const skills = ctx.get('skills');
    // The reading process's workspace: the panel has no session, so this is
    // the only project root it can honestly report against.
    const cwd = process.cwd();
    const presets = await agentPresets.list();
    const entries: PresetToolEntry[] = await Promise.all(presets.map(async (preset) => {
      let entries: ToolSummary[] = [];
      let skillRows: PresetSkillRow[] = [];
      if (preset.broken === undefined) {
        let scope: unknown;
        try {
          scope = await agentPresets.standingKeyFor(preset.id);
          entries = toolSummaries(tools, scope);
        } catch (error) {
          throw new HttpError(503, `preset "${preset.id}" tools are unavailable: ${errorMessage(error)}`);
        }
        if (skills !== undefined) {
          const disabledSkills = new Set(stored.presetSkills[preset.id] ?? []);
          try {
            skillRows = await presetSkillRows(skills, scope, disabledSkills, cwd);
          } catch (error) {
            throw new HttpError(503, `preset "${preset.id}" skills are unavailable: ${errorMessage(error)}`);
          }
        }
      }
      const disabled = new Set(configured[preset.id] ?? []);
      const byName = new Map(entries.map((entry) => [entry.name, entry]));
      const row = (name: string, label: string): PresetToolRow => {
        const description = byName.get(name)?.description;
        return {
          name,
          label,
          ...(description === undefined ? {} : { description }),
          // The reserved transport is reported as on because it IS on: the
          // enforcement listener drops it from the deny list unconditionally.
          // A stale entry naming it (hand-edited, or written before it became
          // reserved) must not render a switch that says "off" over a tool the
          // model can still call -- especially since that switch is locked and
          // the user could never clear the claim.
          enabled: name === RESERVED_TOOL || !disabled.has(name),
          ...(name === RESERVED_TOOL ? { reserved: true } : {}),
        };
      };
      // Same split the session panel uses, from the same helper: MCP tools
      // collapse under their server, everything else is a system tool.
      const mcp: PresetMcpServer[] = groupMcpTools(entries.map((entry) => entry.name)).map((group) => {
        const tools = group.tools.map((tool) => row(`mcp__${group.server}__${tool}`, tool));
        return { server: group.server, tools, enabled: tools.some((tool) => tool.enabled) };
      });
      const systemTools = entries
        .filter((entry) => !entry.name.startsWith('mcp__'))
        .map((entry) => row(entry.name, entry.name));
      return {
        id: preset.id,
        name: preset.name ?? preset.id,
        trust: preset.trust,
        ...(preset.description === undefined ? {} : { description: preset.description }),
        ...(preset.broken === undefined ? {} : { broken: preset.broken }),
        skills: skillRows,
        mcp,
        systemTools,
      };
    }));
    return { presets: entries, writable: ctx.get('settings')?.writable === true };
  };

  // A mask registered against an agent is an effect of THIS fiber, not only of
  // the agent's: disposing the plugin (a hot reload, an unload) has to take its
  // masks with it, or a reload accumulates duplicate shadows of the same skill.
  // The agent's own teardown still disposes its scope; calling a disposer twice
  // is harmless, dropping it entirely is not.
  const masks = new Set<() => void>();
  ctx.effect(() => () => {
    for (const dispose of masks) dispose();
    masks.clear();
  }, 'agent-toolkit: preset masks');

  /**
   * Subscribe to `agent/created` so that NOTHING this plugin does can veto the
   * agent. Cordis treats a synchronous listener failure as a veto and only
   * reports a rejected promise, so both halves have to be contained: the
   * synchronous prelude (reading settings, resolving services) is wrapped here,
   * and the asynchronous body reports through the returned promise. Applying a
   * stored preference is never worth costing the user their session.
   */
  const onAgentCreated = (
    listener: (payload: AgentCreatedPayload) => void | Promise<void>,
  ): void => {
    ctx.on('agent/created', (payload) => {
      try {
        return listener(payload);
      } catch {
        // A settings section that cannot be read or registered leaves the agent
        // exactly as its preset composed it; the panel surfaces the fault.
        return undefined;
      }
    });
  };

  // Applying a stored default must never be able to break session startup.
  // `tools.restrict()` throws on any name its scope does not know, and a stored
  // name can outlive the tool it disabled (a plugin removed, a preset edited),
  // so the deny list is intersected with what this agent actually sees and the
  // call is contained: a default that can no longer apply is dropped, not
  // escalated into a failed agent.
  onAgentCreated(({ agent }) => {
    const stored = settingsScope();
    if (stored === undefined) return;
    const agentPresets = ctx.get('agentPresets');
    const tools = ctx.get('tools');
    if (agentPresets === undefined || tools === undefined) return;
    const presetId = agentPresets.composedPreset(agent.ctx);
    if (presetId === undefined) return;
    const disabled = new Set(stored.get().presets[presetId] ?? []);
    disabled.delete(RESERVED_TOOL);
    if (disabled.size === 0) return;
    const scopedTools = agent.ctx.get('tools');
    if (scopedTools === undefined) return;
    const deny = toolSummaries(tools, agent).map((tool) => tool.name).filter((name) => disabled.has(name));
    if (deny.length === 0) return;
    try {
      masks.add(scopedTools.restrict({ deny }));
    } catch {
      // The registry refused this mask; the agent keeps its preset default.
    }
  });

  // Skills need their own listener because they are masked differently: a tool
  // is denied by name, while a skill is hidden by registering a same-name entry
  // with `modelInvocable: false` into the agent's nearer layer — which means
  // first reading the original, including its body.
  //
  // That read is async, and this listener is deliberately async too. A
  // SYNCHRONOUS throw here would veto agent publication and the session would
  // fail to start; a returned promise's rejection is only reported. Every step
  // is additionally contained, so a skill that can no longer be read is simply
  // left visible rather than costing the user their session.
  onAgentCreated(({ agent }) => {
    const stored = settingsScope();
    if (stored === undefined) return;
    const agentPresets = ctx.get('agentPresets');
    const skills = ctx.get('skills');
    if (agentPresets === undefined || skills === undefined) return;
    const presetId = agentPresets.composedPreset(agent.ctx);
    if (presetId === undefined) return;
    const disabled = stored.get().presetSkills[presetId] ?? [];
    if (disabled.length === 0) return;
    const scopedSkills = (agent as AgentLike).ctx?.get('skills') as ScopedSkillsRegistry | undefined;
    if (scopedSkills === undefined) return;
    // The agent's own cwd, not the panel's: a project skill is masked only for
    // sessions whose workspace actually supplies it.
    const cwd = (agent as AgentLike).session?.header?.cwd;
    const lookup = { ...(cwd === undefined ? {} : { cwd }), scope: agent };
    return (async () => {
      for (const name of disabled) {
        try {
          const original = await skills.get(name, lookup);
          if (original === undefined) continue;
          if (typeof original.name !== 'string' || typeof original.description !== 'string') continue;
          if (typeof original.content !== 'string') continue;
          masks.add(scopedSkills.register({
            name: original.name,
            description: original.description,
            content: original.content,
            source: 'custom',
            provider: 'agent-toolkit',
            ...(original.resourceBase === undefined ? {} : { resourceBase: original.resourceBase }),
            invocation: { modelInvocable: false, userInvocable: true },
          }));
        } catch {
          // Unreadable or already shadowed; leave this skill as the preset had it.
        }
      }
    })();
  });

  // Every write is read-modify-write over the whole namespace, and the settings
  // scope exposes no revision to write against (`replace` closes over the
  // namespace and drops the optimistic-concurrency argument the service itself
  // accepts). Two writes that interleave would therefore each persist a section
  // computed from the same pre-read snapshot, and the later one would silently
  // undo the earlier -- across registries too, since both maps are written
  // together. Serializing the read and the write as one critical section is
  // what keeps a second browser tab, or a fast double-click, from losing a
  // toggle the user actually made.
  let writeQueue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const next = writeQueue.then(work, work);
    writeQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  /** Persist one preset's disabled set for one registry, then re-read. */
  const persist = (
    presetId: string,
    settingsScope: SettingsScopeLike<PresetToolSettings>,
    disabled: ReadonlySet<string>,
    registry: 'presets' | 'presetSkills' = 'presets',
  ): Promise<PresetToolPayload> => serialize(async () => {
    const stored = settingsScope.get();
    // Both maps are always present: each carries a schema default, so a section
    // written before skills existed still resolves with an empty `presetSkills`
    // rather than a missing one. The compatibility layer is the schema, not a
    // guard here -- an optional read would only imply a shape the settings
    // service cannot hand back.
    const prune = (map: Readonly<Record<string, readonly string[]>>): Record<string, readonly string[]> =>
      Object.fromEntries(Object.entries(map).filter(([, value]) => value.length > 0));
    const next = prune({ ...stored[registry], [presetId]: [...disabled].sort() });
    const presets = registry === 'presets' ? next : prune(stored.presets);
    const presetSkills = registry === 'presetSkills' ? next : prune(stored.presetSkills);
    // `replace`, not `update`: the settings merge recurses into the stored
    // section, so a merge patch can only ever add or grow keys. Re-enabling a
    // preset's last disabled tool has to REMOVE its key, and only a wholesale
    // replace of this namespace's user section can express that.
    await settingsScope.replace({ presets, presetSkills });
    return list();
  });

  return {
    list,
    async set(presetId, name, enabled) {
      if (name === RESERVED_TOOL && !enabled) {
        throw new HttpError(409, 'run_code is the reserved Code Mode transport and cannot be restricted');
      }
      const { agentPresets, tools, settings: settingsScope } = services();
      const { tools: available } = await presetAndTools(agentPresets, tools, presetId);
      if (!available.some((tool) => tool.name === name)) throw new HttpError(404, `tool "${name}" is not available in preset "${presetId}"`);
      const disabled = new Set(settingsScope.get().presets[presetId] ?? []);
      if (enabled) disabled.delete(name);
      else disabled.add(name);
      return persist(presetId, settingsScope, disabled);
    },
    async setServer(presetId, server, enabled) {
      const { agentPresets, tools, settings: settingsScope } = services();
      const { tools: available } = await presetAndTools(agentPresets, tools, presetId);
      // One write for the whole server: with 200 MCP tools behind two servers,
      // switching them one request at a time is the interaction this replaces.
      const prefix = `mcp__${server}__`;
      const names = available.map((tool) => tool.name).filter((name) => name.startsWith(prefix));
      if (names.length === 0) throw new HttpError(404, `MCP server "${server}" is not available in preset "${presetId}"`);
      const disabled = new Set(settingsScope.get().presets[presetId] ?? []);
      for (const name of names) {
        if (enabled) disabled.delete(name);
        else disabled.add(name);
      }
      return persist(presetId, settingsScope, disabled);
    },
    async setSkill(presetId, name, enabled) {
      const { agentPresets, settings: settingsScope } = services();
      const skills = requireService(ctx.get('skills'), 'skills service unavailable');
      const presets = await agentPresets.list();
      const preset = presets.find((entry) => entry.id === presetId);
      if (preset === undefined) throw new HttpError(404, `preset "${presetId}" is not available`);
      if (preset.broken !== undefined) throw new HttpError(409, `preset "${presetId}" is broken: ${preset.broken}`);
      let visible: PresetSkillRow[];
      try {
        const scope = await agentPresets.standingKeyFor(presetId);
        visible = await presetSkillRows(skills, scope, new Set(), process.cwd());
      } catch (error) {
        throw new HttpError(503, `preset "${presetId}" skills are unavailable: ${errorMessage(error)}`);
      }
      if (!visible.some((skill) => skill.name === name)) {
        throw new HttpError(404, `skill "${name}" is not available in preset "${presetId}"`);
      }
      const disabled = new Set(settingsScope.get().presetSkills[presetId] ?? []);
      if (enabled) disabled.delete(name);
      else disabled.add(name);
      return persist(presetId, settingsScope, disabled, 'presetSkills');
    },
  };
}
