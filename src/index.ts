import { createCapabilityController } from './host/capabilities.js';
import { registerPresetEnforcement } from './host/preset-enforcement.js';
import { createPresetToolController } from './host/preset-tools.js';
import { createRouteHandler, ROUTE } from './host/route.js';
import { createSessionOverrideStore } from './host/session-overrides.js';
import { createToolkitSettingsAccess } from './host/settings-scope.js';
import { createStatsStore } from './host/stats-store.js';
import type { HostServices } from './host/types.js';

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
  const presetTools = createPresetToolController(ctx, settingsAccess);
  const sessionOverrides = createSessionOverrideStore(settingsAccess);
  registerPresetEnforcement(ctx, capabilities, presetTools, sessionOverrides);
  const handler = createRouteHandler(ctx, capabilities, stats, blockedCounts, presetTools, sessionOverrides);

  ctx.effect(
    () => webServer.register({ kind: 'prefix', path: ROUTE, handler }),
    'agent-toolkit: data route',
  );
}

// Only the route is a hard dependency. Optional services report 503 on preset requests.
export const inject = ['webServer'];
