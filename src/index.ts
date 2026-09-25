import { createCapabilityController } from './host/capabilities.js';
import { scheduleLegacyRecovery } from './host/legacy-import.js';
import { registerPresetEnforcement } from './host/preset-enforcement.js';
import { createPresetToolController } from './host/preset-tools.js';
import { createRouteHandler, ROUTE } from './host/route.js';
import { createSessionOverrideStore } from './host/session-overrides.js';
import { createToolkitSettingsAccess } from './host/settings-scope.js';
import { createStatsStore } from './host/stats-store.js';
import { ToolkitSettingsSchema } from './host/settings-schema.js';
import type { HostServices } from './host/types.js';

/**
 * This plugin's persisted state, declared where dsh 0.1.7 looks for it.
 *
 * The settings rewrite re-keyed every configurable namespace to a profile entry
 * id and moved the values onto the entry's OWN Config, so a plugin that declares
 * no Config is simply absent from the settings surface — `describe()` emits no
 * descriptor and any write fails with `No configurable plugin entry`. Exporting
 * this is what makes the entry configurable at all; the volatile markers inside
 * (see `settings-schema.ts`) are what make writes apply live.
 *
 * It MUST be a named export of the module, not a property of `apply`: the loader
 * resolves a module-shaped plugin down to its `apply` function and then reads
 * `Config` off the enclosing module namespace. Attaching it to the function would
 * be silently ignored.
 */
export const Config = ToolkitSettingsSchema;

/** Host composition root: construct stores/controllers and register the route. */
export function apply(ctx: HostServices): void {
  const webServer = ctx.webServer;
  if (webServer === undefined) return;

  const stats = createStatsStore();
  const blockedCounts = stats.read().blocked;
  const appendStats = (record: Parameters<typeof stats.append>[0]): void => {
    stats.append(record);
  };
  const capabilities = createCapabilityController(ctx, appendStats, blockedCounts);
  // One settings namespace, one write queue: preset defaults and session
  // overrides share both, so the two writers can never clobber each other's
  // read-modify-replace.
  const settingsAccess = createToolkitSettingsAccess(ctx);
  // TEMPORARY(dsh-0.1.7-migration): one-time recovery of sections stranded by
  // the 0.1.7 settings rewrite; remove together with host/legacy-import.ts.
  scheduleLegacyRecovery(ctx, settingsAccess);
  const presetTools = createPresetToolController(ctx, settingsAccess);
  const sessionOverrides = createSessionOverrideStore(settingsAccess);
  registerPresetEnforcement(ctx, capabilities, presetTools, sessionOverrides);
  const handler = createRouteHandler(ctx, capabilities, stats, blockedCounts, presetTools, sessionOverrides);

  ctx.effect(
    () => webServer.register({ kind: 'prefix', path: ROUTE, handler }),
    'capability-panel: data route',
  );
}

// Only the route is a hard dependency. Optional services report 503 on preset requests.
export const inject = ['webServer'];
