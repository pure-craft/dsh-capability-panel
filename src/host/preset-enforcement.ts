import type { CapabilityController } from './capabilities.js';
import type { PresetToolController } from './preset-tools.js';
import type { SessionOverrideStore } from './session-overrides.js';
import type { AgentCreatedPayload, HostServices } from './types.js';

/**
 * Applies stored capability positions to freshly created agents, in two
 * layers: the preset's stored defaults first, then the session's own recorded
 * toggles. The second layer is what survives a restart — a restored session
 * creates a new agent, and its session-bound overrides land on top of the
 * preset defaults, so the user's last word wins (including an explicit
 * re-enable of a preset default).
 *
 * This is deliberately NOT part of the HTTP controller: the listener has no
 * request, and living next to one is how it grew a settings schema, a write
 * queue, and two event subscriptions in a single file. Here it owns exactly
 * one job -- at agent/created, read both stored layers and seed them into the
 * session's capability state.
 *
 * Seeding into the session state (rather than registering private masks) is
 * the point: the session panel's enable path disposes whatever the state
 * holds, whichever layer put it there, so a stored position remains a
 * starting point the user can flip in the session instead of an invisible
 * wall. Session overrides are keyed by session id, so one session's switches
 * can never leak into another.
 */
export function registerPresetEnforcement(
  ctx: HostServices,
  capabilities: CapabilityController,
  presetTools: PresetToolController,
  sessionOverrides: SessionOverrideStore,
): void {
  /**
   * Subscribe to `agent/created` so that NOTHING this plugin does can veto the
   * agent. Cordis treats a synchronous listener failure as a veto and only
   * reports a rejected promise, so both halves are contained: the synchronous
   * prelude (reading settings, resolving services) is wrapped here, and the
   * asynchronous body reports through the returned promise. Applying a stored
   * preference is never worth costing the user their session.
   */
  ctx.on('agent/created', ({ agent }: AgentCreatedPayload) => {
    try {
      if (typeof agent.id !== 'string') return undefined;
      const sessionId = agent.id;
      const presetId = ctx.get('agentPresets')?.composedPreset(agent.ctx);
      const defaults = presetId === undefined ? undefined : presetTools.defaultsFor(presetId);
      const hasDefaults = defaults !== undefined && (defaults.tools.length > 0 || defaults.skills.length > 0);
      const overrides = sessionOverrides.overridesFor(sessionId);
      if (!hasDefaults && overrides === undefined) return undefined;
      return (async () => {
        if (hasDefaults && defaults !== undefined) await capabilities.seed(sessionId, defaults);
        if (overrides !== undefined) await capabilities.restore(sessionId, overrides);
      })();
    } catch {
      // A settings section that cannot be read, or a service that is not there
      // yet, leaves the agent exactly as its preset composed it; the panel
      // surfaces the fault on its next read.
      return undefined;
    }
  });

  /**
   * A preset switch lands AFTER creation (the session header records the
   * composing preset at creation, and the picker's select() recomposes the
   * blank session later): the first agent/created seeded the ORIGINAL
   * preset's defaults, so the new preset's defaults must re-seed on top of a
   * clean slate. Session overrides replay last — the user's own switches in
   * this session outrank either preset's defaults.
   */
  ctx.on('agent-preset/selected', (sessionId: unknown, presetId: unknown) => {
    try {
      if (typeof sessionId !== 'string' || typeof presetId !== 'string') return undefined;
      const defaults = presetTools.defaultsFor(presetId) ?? { tools: [], skills: [] };
      const overrides = sessionOverrides.overridesFor(sessionId);
      return capabilities.reseed(sessionId, defaults, overrides);
    } catch {
      return undefined;
    }
  });

  /**
   * Re-mask when the tool registry changes. seed() can only mask names that
   * are registered at that moment (tools.restrict refuses unknown names), so
   * an on-demand MCP server that connects AFTER the session was created would
   * otherwise arrive with every tool enabled, preset default or not. The
   * registry broadcasts every layer change through this event — late
   * registration, a reconnect's fresh generation, a teardown — and remask is
   * idempotent over names already masked.
   *
   * The guard breaks the echo loop: our own restrict() calls re-emit
   * tools/change, and without it every mask write would schedule another
   * sweep. A change arriving mid-sweep is not lost, though: it is marked
   * pending and one trailing sweep runs when the current one settles, so an
   * external registration landing while a session's slow queue is still
   * processing does not leave stale masks behind.
   */
  let remasking = false;
  let pendingSweep = false;
  ctx.on('tools/change', () => {
    if (remasking) {
      pendingSweep = true;
      return undefined;
    }
    try {
      const agents = ctx.get('agents');
      if (agents === undefined || typeof agents.list !== 'function') return undefined;
      return (async () => {
        do {
          remasking = true;
          pendingSweep = false;
          try {
            let live;
            try {
              live = agents.list();
            } catch {
              // The registry is mid-reload; the next change event re-sweeps.
              return;
            }
            for (const agent of live) {
              try {
                const sessionId = agent?.id;
                if (typeof sessionId !== 'string') continue;
                const presetId = ctx.get('agentPresets')?.composedPreset(agent.ctx);
                const defaults = presetId === undefined ? undefined : presetTools.defaultsFor(presetId);
                const overrides = sessionOverrides.overridesFor(sessionId);
                const hasToolDefaults = defaults !== undefined && defaults.tools.length > 0;
                const hasToolOverrides = overrides !== undefined
                  && (Object.keys(overrides.mcpServers).length > 0
                    || Object.keys(overrides.mcpTools).length > 0
                    || Object.keys(overrides.systemTools).length > 0);
                if (!hasToolDefaults && !hasToolOverrides) continue;
                await capabilities.remask(
                  sessionId,
                  defaults ?? { tools: [], skills: [] },
                  overrides,
                );
              } catch {
                // One session whose stored positions cannot be read keeps its
                // current masks; the sweep continues for the others.
              }
            }
          } finally {
            remasking = false;
          }
        } while (pendingSweep);
      })();
    } catch {
      return undefined;
    }
  });
}
