import z from '@deepseek-ai/schemastery';
import type { HostServices, SettingsScopeLike, ToolkitSettings } from './types.js';

// dsh-settings 0.1.2 removed the settingsNamespace() brander: register takes
// the literal and validates it (lowercase-hyphenated) at the type level and
// at runtime.
export const TOOLKIT_SETTINGS_NAMESPACE = 'capability-panel';

// The schema crosses no declaration boundary: the settings service takes it
// as `unknown`, and annotating it as such sidesteps the non-portable inferred
// type schemastery's z.object produces under declaration emit.
const SessionOverrideSchema: unknown = z.object({
  skills: z.dict(z.boolean()).default({}),
  mcpServers: z.dict(z.boolean()).default({}),
  mcpTools: z.dict(z.boolean()).default({}),
  systemTools: z.dict(z.boolean()).default({}),
});

export const ToolkitSettingsSchema: unknown = z.object({
  presets: z.dict(z.array(z.string())).default({}),
  presetSkills: z.dict(z.array(z.string())).default({}),
  sessions: z.dict(SessionOverrideSchema as never).default({}),
});

export interface ToolkitSettingsAccess {
  /**
   * Lazily registered on first read, not at apply time: this row does not
   * `inject` settings, so at composition the service may not be published yet.
   * Binding it eagerly would freeze an early `undefined` into a permanent 503
   * even after settings arrives.
   */
  scope(): SettingsScopeLike<ToolkitSettings> | undefined;
  /**
   * One write queue for the whole namespace. Every writer (preset defaults,
   * session overrides) persists via a read-modify-`replace` of the same user
   * section, and the scope exposes no revision to write against — so two
   * writers racing would each persist a section computed from the same
   * pre-read snapshot and silently undo each other. Serializing read+write as
   * one critical section is what keeps a session toggle from wiping a preset
   * edit made in another tab.
   */
  serialize<T>(work: () => Promise<T>): Promise<T>;
}

export function createToolkitSettingsAccess(ctx: HostServices): ToolkitSettingsAccess {
  let scope: SettingsScopeLike<ToolkitSettings> | undefined;
  let writeQueue: Promise<unknown> = Promise.resolve();
  return {
    scope() {
      if (scope === undefined) {
        scope = ctx.get('settings')?.register<ToolkitSettings>(
          TOOLKIT_SETTINGS_NAMESPACE,
          ToolkitSettingsSchema,
          { applies: 'live' },
        );
      }
      return scope;
    },
    serialize(work) {
      const next = writeQueue.then(work, work);
      writeQueue = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  };
}
