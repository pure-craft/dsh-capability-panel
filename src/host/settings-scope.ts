import type { HostServices, SettingsScopeLike, ToolkitSettings } from './types.js';
import { normalizeToolkitSettings, ToolkitSettingsSchemaShape } from './settings-schema.js';

// dsh-settings 0.1.2 removed the settingsNamespace() brander: register takes
// the literal and validates it (lowercase-hyphenated) at the type level and
// at runtime. From 0.1.7 the literal is only the FALLBACK namespace — see
// entryNamespace() — because that release re-keyed settings to profile entry ids.
export const TOOLKIT_SETTINGS_NAMESPACE = 'capability-panel';

/** A whole-section read of the namespace, from either host shape. */
type SectionRead = () => ToolkitSettings;
/** A wholesale section write, normalized across host shapes to one call. */
type SectionWrite = (section: object) => Promise<void>;

/** One descriptor row from the 0.1.7 settings form inventory. */
interface SettingsDescriptorLike {
  readonly ns?: unknown;
  readonly value?: unknown;
}

/** The slice of the settings service this plugin probes for. */
interface SettingsLike {
  register?: (
    namespace: string,
    schema: unknown,
    options?: { applies?: 'live' | 'restart' },
  ) => SettingsScopeLike<ToolkitSettings>;
  describe?: (options?: { redactSecrets?: boolean }) => readonly SettingsDescriptorLike[];
  replace?: (namespace: string, section: object, expectedRevision?: number) => Promise<void>;
}

/**
 * Resolve the namespace this plugin's data lives under.
 *
 * dsh ≤ 0.1.6 addressed settings by a literal name, so `capability-panel` was
 * the whole answer. 0.1.7 re-keyed every configurable namespace to the PROFILE
 * ENTRY ID, and the settings service looks entries up by exactly that id — so
 * asking for the literal would miss whenever a profile mounts this bundle under
 * a different row id. The id is read from this plugin's own fiber, which is only
 * absent when the plugin was mounted without the Loader (a bare `ctx.plugin`
 * call); the historical literal is the graceful fallback, and it is also what
 * this repo's own bundle patch inserts, so the common case resolves either way.
 */
function entryNamespace(ctx: HostServices): string {
  const id = ctx.fiber?.entry?.options?.id;
  return typeof id === 'string' && id !== '' ? id : TOOLKIT_SETTINGS_NAMESPACE;
}

/**
 * Build the read/write pair off whichever settings API the live service offers.
 *
 * dsh ≤ 0.1.6 exposed `register(ns, schema)` returning a scope with
 * get/replace. The 0.1.7 forms rewrite dropped `register` entirely: values now
 * live on the plugin entry's own Config (volatile fields), reads come through
 * `describe()` descriptors, and writes go through `replace(ns, section)` —
 * which resets every live field before applying the section, so passing the
 * complete three-key section is exactly what that verb expects. The caller
 * caches the pair against the service instance; a replaced service rebinds.
 */
function bindSection(settings: unknown, namespace: string): { read: SectionRead; write: SectionWrite } | undefined {
  if (settings === null || typeof settings !== 'object') return undefined;
  const host = settings as SettingsLike;
  if (typeof host.register === 'function') {
    // The legacy scope is memoized against the same service instance for the
    // same reason the pair is: a second register() for one namespace throws
    // "already registered".
    let scope: SettingsScopeLike<ToolkitSettings> | undefined;
    const bind = (): SettingsScopeLike<ToolkitSettings> =>
      (scope ??= host.register!(namespace, ToolkitSettingsSchemaShape, { applies: 'live' }));
    return {
      read: () => normalizeToolkitSettings(bind().get()),
      write: (section) => bind().replace(section),
    };
  }
  if (typeof host.describe === 'function' && typeof host.replace === 'function') {
    const read: SectionRead = () => {
      for (const descriptor of host.describe!()) {
        if (descriptor.ns !== namespace) continue;
        // `describe()` already projects the schema-declared form, so a section
        // written before a key existed still resolves with the defaults the
        // schema carries rather than missing keys.
        return normalizeToolkitSettings(descriptor.value);
      }
      throw new Error(`settings entry "${namespace}" is not configurable`);
    };
    return { read, write: (section) => host.replace!(namespace, section) };
  }
  return undefined;
}

export interface ToolkitSettingsAccess {
  /**
   * Lazily bound on first read, not at apply time: this row does not `inject`
   * settings, so at composition the service may not be published yet. Binding
   * it eagerly would freeze an early `undefined` into a permanent 503 even
   * after settings arrives.
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
  let writeQueue: Promise<unknown> = Promise.resolve();
  // The bound pair is cached while the SAME settings instance answers; a
  // replaced service (an HMR reload publishes a new one) rebinds. Without the
  // cache, the legacy shape would re-`register` on every read and its second
  // registration throws "already registered".
  let cachedService: unknown;
  let cachedPair: { read: SectionRead; write: SectionWrite } | undefined;
  return {
    scope() {
      // Non-strict read: the settings provider may be mid-activation during
      // startup or an HMR reload, and a strict get would freeze that moment
      // into a permanent 503. A genuinely unmounted service still resolves
      // undefined and keeps this lazy — the next read retries.
      const settings = ctx.get('settings', false);
      if (settings === undefined) return undefined;
      if (settings !== cachedService || cachedPair === undefined) {
        cachedService = settings;
        cachedPair = bindSection(settings, entryNamespace(ctx));
      }
      if (cachedPair === undefined) return undefined;
      return { get: cachedPair.read, replace: cachedPair.write };
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