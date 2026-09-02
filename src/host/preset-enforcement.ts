import type { CapabilityController } from './capabilities.js';
import type { PresetToolController } from './preset-tools.js';
import type { AgentCreatedPayload, HostServices } from './types.js';

/**
 * Applies each preset's stored defaults to the sessions that preset creates.
 *
 * This is deliberately NOT part of the HTTP controller: the listener has no
 * request, and living next to one is how it grew a settings schema, a write
 * queue, and two event subscriptions in a single file. Here it owns exactly
 * one job -- at agent/created, read the defaults for the agent's preset and
 * seed them into the session's capability state.
 *
 * Seeding into the session state (rather than registering private masks) is
 * the point: the session panel's enable path disposes whatever the state
 * holds, whichever layer put it there, so a preset default remains a default
 * the user can override in the session instead of an invisible wall.
 */
export function registerPresetEnforcement(
  ctx: HostServices,
  capabilities: CapabilityController,
  presetTools: PresetToolController,
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
      const presetId = ctx.get('agentPresets')?.composedPreset(agent.ctx);
      if (presetId === undefined) return undefined;
      const defaults = presetTools.defaultsFor(presetId);
      if (defaults === undefined) return undefined;
      if (defaults.tools.length === 0 && defaults.skills.length === 0) return undefined;
      if (typeof agent.id !== 'string') return undefined;
      return capabilities.seed(agent.id, defaults);
    } catch {
      // A settings section that cannot be read, or a service that is not there
      // yet, leaves the agent exactly as its preset composed it; the panel
      // surfaces the fault on its next read.
      return undefined;
    }
  });
}
