import z from '@deepseek-ai/schemastery';
import type { ToolkitSettings } from './types.js';

/**
 * The plugin's own Config schema — and the reason this file exists at all.
 *
 * dsh ≤ 0.1.6 stored this plugin's data in a settings namespace addressed by a
 * literal name: the plugin called `settings.register('capability-panel', schema)`
 * and the settings service owned both the storage and the shape. The 0.1.7
 * settings rewrite deleted `register` outright. Values now live on the plugin
 * entry's OWN Config, reads come from `describe()` descriptors derived from that
 * schema, and writes go through `replace(entryId, section)`.
 *
 * The consequence is that the namespace is no longer a string this plugin
 * chooses: it is the profile entry id, and the entry is configurable ONLY when
 * its Config declares at least one volatile field — `volatileForm` otherwise
 * returns undefined and a write refuses with "has no volatile fields". A plugin
 * with no Config is invisible to the settings surface, which is exactly the
 * breakage this file repairs.
 *
 * Marking the three FIELDS volatile (rather than the root object) is the shape
 * the form model requires, for two independent reasons:
 *  - A volatile field nested beneath an enclosing volatile field is rejected
 *    outright ("volatile fields require a fixed object path without an enclosing
 *    volatile field"), so the two styles cannot be mixed.
 *  - A root-volatile schema collapses the whole config into one live form. This
 *    Config is the plugin's entire persisted surface, so from 0.1.7 it is also
 *    the only place a future non-live (restart-guarded) setting could live;
 *    keeping the volatile marker on the data fields preserves that room.
 * Field-level marking also matches the first-party idiom
 * (`dsh-permission-presets`, `dsh-agent-preset-registry`).
 *
 * `presets`, `presetSkills` and `sessions` stay dynamic-keyed maps: their keys
 * are user-chosen preset and session ids. `isVolatilePath` short-circuits on a
 * volatile ancestor, so a write may address any key beneath them.
 *
 * The marker is applied with `.extra('volatile', true)` rather than `.volatile()`
 * on purpose. Both emit the same `meta.volatile` and, on a copy that implements
 * it, the same live reference wrapping — but `.volatile()` only exists from
 * schemastery 3.18.4, so a host resolving an older copy would throw a TypeError
 * while merely LOADING this module. `.extra()` is present in every supported
 * version, so an older host degrades to metadata it ignores instead of failing
 * to start. (The repo's own dependency is pinned to 3.18.4, matching the
 * `~3.18.4` peer that dsh-settings 0.1.7 declares.) This is also why the field
 * type stays a plain schema: `.extra()` does not widen it to `Volatile<T>`.
 */
const volatileField = <T>(schema: T): T => (schema as { extra(key: string, value: unknown): T }).extra('volatile', true);

const SessionOverrideSchema = z.object({
  skills: z.dict(z.boolean()).default({}),
  mcpServers: z.dict(z.boolean()).default({}),
  mcpTools: z.dict(z.boolean()).default({}),
  systemTools: z.dict(z.boolean()).default({}),
});

/**
 * This plugin's Config: the live half of its persisted state.
 *
 * Every field carries a `.default({})`, so a profile that has never stored
 * anything still resolves all three keys. That matters because `describe()`'s
 * `value` is projected from the resolved config: without defaults a fresh
 * install would surface `undefined` for each key and every reader would have to
 * guard, while with them the access layer can hand back a complete section.
 */
export const ToolkitSettingsSchema: Schemastery = z.object({
  presets: volatileField(z.dict(z.array(z.string())).default({})),
  presetSkills: volatileField(z.dict(z.array(z.string())).default({})),
  sessions: volatileField(z.dict(SessionOverrideSchema).default({})),
});

/**
 * A schema-free stand-in for the legacy `register` path.
 *
 * dsh ≤ 0.1.6 takes the schema as `unknown` and validates against it, so the
 * same shape works there; but volatile metadata is meaningless to that service,
 * and annotating this as `unknown` keeps the non-portable declaration type that
 * `z.object` infers out of this module's public surface.
 */
export const ToolkitSettingsSchemaShape: unknown = z.object({
  presets: z.dict(z.array(z.string())).default({}),
  presetSkills: z.dict(z.array(z.string())).default({}),
  sessions: z.dict(SessionOverrideSchema).default({}),
});

/** Fill in the schema defaults, so no reader has to guard three maps. */
export function normalizeToolkitSettings(value: unknown): ToolkitSettings {
  const section = (value ?? {}) as Partial<ToolkitSettings>;
  return {
    presets: section.presets ?? {},
    presetSkills: section.presetSkills ?? {},
    sessions: section.sessions ?? {},
  };
}