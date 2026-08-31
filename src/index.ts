import { createCapabilityController } from './host/capabilities.js';
import { createRouteHandler, ROUTE } from './host/route.js';
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
  const handler = createRouteHandler(ctx, capabilities, stats, blockedCounts);

  ctx.effect(
    () => webServer.register({ kind: 'prefix', path: ROUTE, handler }),
    'agent-toolkit: data route',
  );
}

// Only the route is a hard dependency. Optional catalog services degrade per request.
export const inject = ['webServer'];
