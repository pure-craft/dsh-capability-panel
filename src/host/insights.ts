import type { InsightPreset, InsightUsage, InsightsBackfillResult, InsightsPayload, InsightsQuery } from '../insights-contract.js';
import { applyInsights, createInsightsDefinition, initInsights, INSIGHTS_KEY, insightsStateSchema, recordOf } from './insights-fold.js';
import type { InsightsEvent, InsightsHeader, InsightsState } from './insights-fold.js';

import { createInsightsStore } from './insights-store.js';

interface SessionRecord { header: InsightsHeader }
function headerIdentity(header: InsightsHeader): string { return JSON.stringify(header); }
interface LiveSession { header: InsightsHeader; seq: number }
interface Projections {
  register(definition: ReturnType<typeof createInsightsDefinition>): () => void;
  stateOf(session: LiveSession, key: string): unknown;
}
interface Query { listSessions(signal?: AbortSignal): Promise<SessionRecord[]> }
interface Cache { cachedSnapshot(header: InsightsHeader, keys: readonly string[]): unknown }
interface Persistence {
  stat(id: string): Promise<{ revision: string; eventCount?: number } | undefined>;
  open(id: string, access: 'read', options: { signal?: AbortSignal | undefined }): Promise<{
    header: InsightsHeader; inheritedEventCount: number;
    read(offset: number, length: number, options: { signal?: AbortSignal | undefined }): Promise<{ events: readonly InsightsEvent[] }>;
    close(): Promise<void>;
  }>;
}
export interface InsightsContext { get(name: string, strict?: boolean): unknown }
interface Cell { state: InsightsState; next: number; complete: boolean; revision: string }
function parsedState(value: unknown): InsightsState | undefined {
  const result = insightsStateSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
function rows(values: Record<string, { count: number; lastUsed: number | null }>): InsightUsage[] {
  return Object.entries(values).map(([name, value]) => ({ name, ...value })).sort((a, b) => a.name.localeCompare(b.name));
}
function latest(a: number | null, b: number | null): number | null {
  return a === null ? b : b === null ? a : Math.max(a, b);
}
export function createInsightsController(ctx: InsightsContext) {
  const cells = new Map<string, Cell>();
  const store = createInsightsStore(ctx);
  let active = false;
  let disposed = false;
  let registered: Projections | undefined;
  let unregister: (() => void) | undefined;
  function projections(): Projections | undefined {
    const service = ctx.get('sessionProjections', false) as Projections | undefined;
    if (service !== registered) {
      unregister?.();
      registered = service;
      unregister = service?.register(createInsightsDefinition());
    }
    return service;
  }
  try { projections(); } catch { /* Optional services can still be mounting. */ }
  async function source(query: InsightsQuery, signal?: AbortSignal) {
    const service = ctx.get('sessionQuery', false) as Query | undefined;
    if (service === undefined) throw new Error('Session history listing is unavailable');
    const records = await service.listSessions(signal);
    const cwd = query.scope === 'workspace'
      ? records.find(row => row.header.id === query.sessionId)?.header.cwd ?? null : null;
    if (query.scope === 'workspace' && cwd === null) throw new Error('Workspace session directory is unknown');
    return { records: records.filter(row => query.scope === 'global' || row.header.cwd === cwd), cwd };
  }
  async function stateFor(header: InsightsHeader): Promise<{ state?: InsightsState; complete: boolean }> {
    const agents = ctx.get('agents', false) as { get(id: string): { session?: LiveSession } | undefined } | undefined;
    const live = agents?.get(header.id)?.session;
    const projection = projections();
    if (live !== undefined && projection !== undefined) {
      const state = parsedState(projection.stateOf(live, INSIGHTS_KEY));
      return { ...(state === undefined ? {} : { state }), complete: state !== undefined && !state.limited };
    }
    const persistence = ctx.get('sessionPersistence', false) as Persistence | undefined;
    const cell = cells.get(header.id);
    if (cell !== undefined) {
      const stat = await persistence?.stat(header.id);
      if (stat?.revision === cell.revision) return { state: cell.state, complete: cell.complete && !cell.state.limited };
      cells.delete(header.id);
    }
    const cache = ctx.get('sessionProjectionCache', false) as Cache | undefined;
    const snapshot = recordOf(cache?.cachedSnapshot(header, [INSIGHTS_KEY]));
    let state = parsedState(recordOf(snapshot['values'])[INSIGHTS_KEY]);
    if (state === undefined) {
      const stored = await store.get(header.id);
      if (stored?.header === headerIdentity(header)) state = stored.state;
    }
    // A persisted checkpoint is a lower bound: the listing has no current log cursor.
    return { ...(state === undefined ? {} : { state }), complete: false };
  }
  async function read(query: InsightsQuery): Promise<InsightsPayload> {
    const warnings: string[] = [];
    const tools: Record<string, { count: number; lastUsed: number | null }> = {};
    const skills: typeof tools = {};
    const presets = new Map<string | null, InsightPreset>();
    let knownSessions = 0;
    let indexedSessions = 0;
    let complete = true;
    let cwd: string | null = null;
    try {
      const listing = await source(query);
      cwd = listing.cwd;
      knownSessions = listing.records.length;
      for (const { header } of listing.records) {
        try {
          const result = await stateFor(header);
          complete &&= result.complete;
          const state = result.state;
          if (state === undefined) continue;
          indexedSessions++;
          const old = presets.get(state.presetId);
          const all = [...Object.values(state.tools), ...Object.values(state.skills)];
          presets.set(state.presetId, {
            presetId: state.presetId, sessions: (old?.sessions ?? 0) + 1,
            toolCalls: (old?.toolCalls ?? 0) + Object.values(state.tools).reduce((n, v) => n + v.count, 0),
            skillCalls: (old?.skillCalls ?? 0) + Object.values(state.skills).reduce((n, v) => n + v.count, 0),
            lastUsed: all.reduce((n: number | null, v) => latest(n, v.lastUsed), old?.lastUsed ?? null),
          });
          if (query.presetId !== undefined && state.presetId !== query.presetId) continue;
          for (const kind of ['tools', 'skills'] as const) {
            const target = kind === 'tools' ? tools : skills;
            for (const [name, value] of Object.entries(state[kind])) {
              const previous = Object.hasOwn(target, name) ? target[name] : undefined;
              Object.defineProperty(target, name, { value: { count: (previous?.count ?? 0) + value.count,
                lastUsed: latest(previous?.lastUsed ?? null, value.lastUsed) }, enumerable: true, configurable: true });
            }
          }
        } catch (error) { complete = false; warnings.push(`Session ${header.id}: ${String(error)}`); }
      }
    } catch (error) { complete = false; warnings.push(String(error)); }
    complete &&= indexedSessions === knownSessions;
    return { scope: query.scope, cwd, presetId: query.presetId ?? null,
      coverage: { knownSessions, indexedSessions, complete, unknown: !complete },
      tools: rows(tools), skills: rows(skills), presets: [...presets.values()], warnings };
  }
  async function backfill(query: InsightsQuery, signal?: AbortSignal): Promise<InsightsBackfillResult> {
    if (active || disposed) return { processedSessions: 0, remainingSessions: 0, warnings: ['Backfill is already active or disposed'] };
    active = true;
    let processedSessions = 0;
    let remainingSessions = 0;
    const warnings: string[] = [];
    try {
      const persistence = ctx.get('sessionPersistence', false) as Persistence | undefined;
      if (persistence === undefined) throw new Error('Bounded history reads are unavailable');
      const { records } = await source(query, signal);
      let budget = 2000;
      let visited = 0;
      for (const { header } of records) {
        if (signal?.aborted === true || disposed) { remainingSessions++; continue; }
        const existing = await stateFor(header);
        if (existing.complete) continue;
        remainingSessions++;
        if (budget <= 0 || visited >= 20) continue;
        visited++;
        try {
          const stat = await persistence.stat(header.id);
          if (stat === undefined) continue;
          const handle = await persistence.open(header.id, 'read', { signal });
          try {
            let cell = cells.get(header.id);
            if (cell?.revision !== stat.revision) cell = { state: initInsights(handle.header, handle.inheritedEventCount), next: 0, complete: false, revision: stat.revision };
            while (budget > 0 && !cell.complete && !Boolean(signal?.aborted) && !disposed) {
              const length = Math.min(100, budget);
              const { events } = await handle.read(cell.next, length, { signal });
              if (events.length > length) throw new Error('History backend exceeded bounded read');
              budget -= length;
              for (const event of events) {
                if (event.seq !== cell.next) throw new Error('History changed during backfill');
                cell = { ...cell, state: applyInsights(cell.state, event), next: cell.next + 1 };
              }
              cell = { ...cell, complete: events.length < length };
              cells.set(header.id, cell);
            }
            const after = await persistence.stat(header.id);
            if (after?.revision !== stat.revision) { cells.delete(header.id); continue; }
            if (cell.complete) {
              processedSessions++; remainingSessions--;
              await store.put(header.id, { header: headerIdentity(handle.header), state: cell.state, next: cell.next });
            }
          } finally { await handle.close(); }
        } catch (error) { cells.delete(header.id); warnings.push(`Session ${header.id}: ${String(error)}`); }
      }
    } catch (error) { warnings.push(String(error)); }
    finally { active = false; }
    return { processedSessions, remainingSessions, warnings };
  }
  return { read, backfill, connect: projections, async dispose() { disposed = true; unregister?.(); cells.clear(); await store.close(); } };
}
