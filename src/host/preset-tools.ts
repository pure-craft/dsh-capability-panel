import { settingsNamespace } from '@deepseek-ai/dsh-settings';
import z from '@deepseek-ai/schemastery';
import { errorMessage, HttpError } from './errors.js';
import type {
  AgentPresetLike,
  AgentPresetsService,
  HostServices,
  PresetToolEntry,
  PresetToolPayload,
  PresetToolSettings,
  SettingsScopeLike,
  ToolsService,
} from './types.js';

export const PRESET_SETTINGS_NAMESPACE = settingsNamespace('agent-toolkit');
export const RESERVED_TOOL = 'run_code';

const PresetToolSettingsSchema = z.object({
  presets: z.dict(z.array(z.string())).default({}),
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
    const configured = settingsScope.get().presets;
    const presets = await agentPresets.list();
    const entries: PresetToolEntry[] = await Promise.all(presets.map(async (preset) => {
      let entries: ToolSummary[] = [];
      if (preset.broken === undefined) {
        try {
          entries = toolSummaries(tools, await agentPresets.standingKeyFor(preset.id));
        } catch (error) {
          throw new HttpError(503, `preset "${preset.id}" tools are unavailable: ${errorMessage(error)}`);
        }
      }
      const disabled = new Set(configured[preset.id] ?? []);
      return {
        id: preset.id,
        name: preset.name ?? preset.id,
        trust: preset.trust,
        ...(preset.description === undefined ? {} : { description: preset.description }),
        ...(preset.broken === undefined ? {} : { broken: preset.broken }),
        tools: entries.map((entry) => ({
          ...entry,
          enabled: !disabled.has(entry.name),
          ...(entry.name === RESERVED_TOOL ? { reserved: true } : {}),
        })),
      };
    }));
    return { presets: entries, writable: ctx.get('settings')?.writable === true };
  };

  // Applying a stored default must never be able to break session startup.
  // `tools.restrict()` throws on any name its scope does not know, and a stored
  // name can outlive the tool it disabled (a plugin removed, a preset edited),
  // so the deny list is intersected with what this agent actually sees and the
  // call is contained: a default that can no longer apply is dropped, not
  // escalated into a failed agent.
  ctx.on('agent/created', ({ agent }) => {
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
      scopedTools.restrict({ deny });
    } catch {
      // The registry refused this mask; the agent keeps its preset default.
    }
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
      const current = settingsScope.get().presets;
      const disabled = new Set(current[presetId] ?? []);
      if (enabled) disabled.delete(name);
      else disabled.add(name);
      const presets = Object.fromEntries(
        Object.entries({ ...current, [presetId]: [...disabled].sort() }).filter(([, value]) => value.length > 0),
      );
      // `replace`, not `update`: the settings merge recurses into the stored
      // section, so a merge patch can only ever add or grow keys. Re-enabling a
      // preset's last disabled tool has to REMOVE its key, and only a wholesale
      // replace of this namespace's user section can express that.
      await settingsScope.replace({ presets });
      return list();
    },
  };
}
