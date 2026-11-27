import type { InsightsPayload, InsightUsage, InsightPreset } from './insights-contract.js';

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid insights response');
  return value as Record<string, unknown>;
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid insights count');
  return value;
}
function nullableString(value: unknown): string | null {
  if (value !== null && typeof value !== 'string') throw new Error('Invalid insights name');
  return value;
}
function time(value: unknown): number | null {
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new Error('Invalid insights time');
  return value;
}
function rows<T>(value: unknown, parse: (row: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new Error('Invalid insights rows');
  return value.map(parse);
}
function usage(value: unknown): InsightUsage {
  const row = record(value);
  if (typeof row.name !== 'string' || row.name === '') throw new Error('Invalid insights capability');
  return { name: row.name, count: count(row.count), lastUsed: time(row.lastUsed) };
}
function preset(value: unknown): InsightPreset {
  const row = record(value);
  return { presetId: nullableString(row.presetId), sessions: count(row.sessions), toolCalls: count(row.toolCalls), skillCalls: count(row.skillCalls), lastUsed: time(row.lastUsed) };
}
export function parseInsightsPayload(value: unknown): InsightsPayload {
  const row = record(value);
  const coverage = record(row.coverage);
  if (row.scope !== 'workspace' && row.scope !== 'global') throw new Error('Invalid insights scope');
  if (typeof coverage.complete !== 'boolean' || typeof coverage.unknown !== 'boolean') throw new Error('Invalid insights coverage');
  return {
    scope: row.scope, cwd: nullableString(row.cwd), presetId: nullableString(row.presetId),
    coverage: { knownSessions: count(coverage.knownSessions), indexedSessions: count(coverage.indexedSessions), complete: coverage.complete, unknown: coverage.unknown },
    tools: rows(row.tools, usage), skills: rows(row.skills, usage), presets: rows(row.presets, preset),
    warnings: rows(row.warnings, value => { if (typeof value !== 'string') throw new Error('Invalid insights warning'); return value; }),
  };
}
