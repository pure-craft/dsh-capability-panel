import { HttpError } from './errors.js';
import type { ToolkitSettingsAccess } from './settings-scope.js';
import type { CapabilityKind, SessionOverrideState } from './types.js';

/**
 * Session-bound switch positions, persisted in the toolkit settings namespace
 * so a restored session gets its own toggles back after a restart.
 *
 * The binding is the session id: a record is read only by the session that
 * made it, so one session's switch can never leak into another. What changes
 * at a restart is only WHEN it is read — the masks themselves are re-applied
 * by the same capability controller the panel uses, over the fresh agent.
 *
 * The store is a record of user intent, not a snapshot of derived state: an
 * explicit `true` matters only when a preset default masks the name, and
 * recording every toggle's final value keeps the write path dumb (no preset
 * lookup needed) while restore order (defaults first, overrides second) makes
 * the user's last word win.
 */

/** Kind keys map 1:1 onto SessionOverrideState's fields. */
const KIND_KEYS = {
  skill: 'skills',
  'mcp-server': 'mcpServers',
  'mcp-tool': 'mcpTools',
  'system-tool': 'systemTools',
} as const;

/**
 * Retained session records cap. A record costs a handful of names, and a
 * session the user never revisits is pruned oldest-first — the alternative
 * (unbounded growth in a settings file) trades a real read cost for a
 * scenario nobody has.
 */
export const MAX_SESSION_RECORDS = 200;

export interface SessionOverrideStore {
  /**
   * The stored positions for one session, for the agent/created listener.
   * Returns undefined when settings cannot be read: enforcement treats that
   * as "no overrides" rather than fail a session over a preference.
   */
  overridesFor(sessionId: string): SessionOverrideState | undefined;
  /**
   * Persist one toggle's final position for one session. Throws when the
   * settings service is absent or the write fails — the caller has already
   * applied the in-memory mask, so it reports this as a degraded note, not a
   * failed toggle.
   */
  record(sessionId: string, kind: CapabilityKind, name: string, enabled: boolean): Promise<void>;
}

export function createSessionOverrideStore(access: ToolkitSettingsAccess): SessionOverrideStore {
  return {
    overridesFor(sessionId) {
      try {
        return access.scope()?.get().sessions[sessionId];
      } catch {
        return undefined;
      }
    },
    async record(sessionId, kind, name, enabled) {
      const scope = access.scope();
      if (scope === undefined) throw new HttpError(503, 'settings service unavailable');
      await access.serialize(async () => {
        const stored = scope.get();
        const kindKey = KIND_KEYS[kind];
        const current = stored.sessions[sessionId];
        const next: SessionOverrideState = {
          skills: { ...current?.skills },
          mcpServers: { ...current?.mcpServers },
          mcpTools: { ...current?.mcpTools },
          systemTools: { ...current?.systemTools },
          [kindKey]: { ...current?.[kindKey], [name]: enabled },
        };
        // Rebuild rather than mutate: dropping the id first and re-appending
        // it makes it the newest entry, so the cap evicts oldest-first
        // (Object.entries preserves string-key insertion order).
        const entries = Object.entries(stored.sessions).filter(([id]) => id !== sessionId);
        entries.push([sessionId, next]);
        const sessions: Record<string, SessionOverrideState> = Object.fromEntries(entries.slice(-MAX_SESSION_RECORDS));
        await scope.replace({
          presets: stored.presets,
          presetSkills: stored.presetSkills,
          sessions,
        });
      });
    },
  };
}
