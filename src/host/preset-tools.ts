import { errorMessage, HttpError } from './errors.js';
import type {
  AgentPresetLike,
  AgentPresetsService,
  HostServices,
  PresetMcpServer,
  PresetSkillRow,
  PresetToolEntry,
  PresetToolPayload,
  PresetToolRow,
  SkillsService,
  ToolsService,
  ToolkitSettings,
} from './types.js';
import type { ToolkitSettingsAccess } from './settings-scope.js';
import { TOOLKIT_SETTINGS_NAMESPACE } from './settings-scope.js';
import { groupMcpTools } from '../load-state.js';

// Kept for the tests and any importer that names the settings row: the
// namespace now lives with the shared scope accessor so the preset controller
// and the session-override store cannot register divergent schemas.
export { TOOLKIT_SETTINGS_NAMESPACE as PRESET_SETTINGS_NAMESPACE };
import { RESERVED_TOOL } from './reserved.js';
export { RESERVED_TOOL };

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
  /**
   * The stored defaults for one preset, for the enforcement listener. Returns
   * undefined when settings cannot be read: enforcement treats that as "no
   * defaults" rather than fail a session over a preference it cannot read.
   */
  defaultsFor(presetId: string): { tools: readonly string[]; skills: readonly string[] } | undefined;
}

export function createPresetToolController(ctx: HostServices, access: ToolkitSettingsAccess): PresetToolController {
  const settingsScope = (): ReturnType<ToolkitSettingsAccess['scope']> => access.scope();

  const services = (): { agentPresets: AgentPresetsService; tools: ToolsService; settings: NonNullable<ReturnType<ToolkitSettingsAccess['scope']>> } => ({
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

  // Every write is read-modify-write over the whole namespace, serialized
  // through the SHARED access queue (settings-scope.ts) so a preset edit and
  // a session toggle cannot interleave their snapshots.

  /** Persist one preset's disabled set for one registry, then re-read. */
  const persist = (
    presetId: string,
    settingsScope: NonNullable<ReturnType<ToolkitSettingsAccess['scope']>>,
    disabled: ReadonlySet<string>,
    registry: 'presets' | 'presetSkills' = 'presets',
  ): Promise<PresetToolPayload> => access.serialize(async () => {
    const stored = settingsScope.get();
    // All maps are always present: each carries a schema default, so a section
    // written before skills/sessions existed still resolves with empty ones
    // rather than missing keys. The compatibility layer is the schema, not a
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
    // replace of this namespace's user section can express that. `sessions`
    // passes through untouched: session-bound overrides belong to the other
    // writer sharing this namespace, and dropping them here would silently
    // unpersist every session's switches.
    await settingsScope.replace({ presets, presetSkills, sessions: stored.sessions });
    return list();
  });

  return {
    defaultsFor(presetId) {
      let stored: ToolkitSettings;
      try {
        const settings = settingsScope();
        if (settings === undefined) return undefined;
        stored = settings.get();
      } catch {
        return undefined;
      }
      const tools = (stored.presets[presetId] ?? []).filter((name) => name !== RESERVED_TOOL);
      return { tools, skills: stored.presetSkills[presetId] ?? [] };
    },
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
