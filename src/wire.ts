/**
 * Runtime guards for the wire contract.
 *
 * `contract.ts` stays types-only; this module is its runtime half. The host
 * validates every service boundary read (failures land in `degraded`), so the
 * client must not bare-cast `response.json()` either — a host/client version
 * skew (client hot-reloads, host needs a restart) is exactly when shapes
 * diverge, and a rejected payload must read as an error, not as "no skills".
 */
import type { InspectorPayload, McpServerEntry, McpToolEntry, SkillEntry, ToolEntry } from './contract.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const optString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

function parseSkillEntry(value: unknown): SkillEntry | null {
  if (!isRecord(value) || typeof value['name'] !== 'string') return null;
  const state = value['state'];
  if (state !== 'loaded' && state !== 'evicted' && state !== 'unloaded') return null;
  if (typeof value['enabled'] !== 'boolean' || typeof value['loadCount'] !== 'number') return null;
  const description = optString(value['description']);
  return {
    name: value['name'],
    state,
    enabled: value['enabled'],
    loadCount: value['loadCount'],
    ...(description === undefined ? {} : { description }),
  };
}

function parseToolEntry(value: unknown): ToolEntry | null {
  if (!isRecord(value) || typeof value['name'] !== 'string' || typeof value['label'] !== 'string') return null;
  if (typeof value['enabled'] !== 'boolean') return null;
  const description = optString(value['description']);
  return {
    name: value['name'],
    label: value['label'],
    enabled: value['enabled'],
    ...(description === undefined ? {} : { description }),
    ...(value['reserved'] === true ? { reserved: true } : {}),
  };
}

function parseMcpToolEntry(value: unknown): McpToolEntry | null {
  return parseToolEntry(value);
}

function parseMcpServerEntry(value: unknown): McpServerEntry | null {
  if (!isRecord(value) || typeof value['server'] !== 'string' || typeof value['enabled'] !== 'boolean') return null;
  if (!Array.isArray(value['tools'])) return null;
  const tools: McpToolEntry[] = [];
  for (const tool of value['tools']) {
    const parsed = parseMcpToolEntry(tool);
    if (parsed === null) return null;
    tools.push(parsed);
  }
  return { server: value['server'], enabled: value['enabled'], tools };
}

function parseBlocked(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    if (typeof count !== 'number') return null;
    out[key] = count;
  }
  return out;
}

/** Parse one wire payload; null means the shape is not ours (version skew). */
export function parseInspectorPayload(value: unknown): InspectorPayload | null {
  if (!isRecord(value)) return null;
  const sessionId = value['sessionId'];
  if (sessionId !== null && typeof sessionId !== 'string') return null;
  if (!Array.isArray(value['skills']) || !Array.isArray(value['mcp']) || !Array.isArray(value['systemTools'])) {
    return null;
  }
  const skills: SkillEntry[] = [];
  for (const skill of value['skills']) {
    const parsed = parseSkillEntry(skill);
    if (parsed === null) return null;
    skills.push(parsed);
  }
  const mcp: McpServerEntry[] = [];
  for (const server of value['mcp']) {
    const parsed = parseMcpServerEntry(server);
    if (parsed === null) return null;
    mcp.push(parsed);
  }
  const systemTools: ToolEntry[] = [];
  for (const tool of value['systemTools']) {
    const parsed = parseToolEntry(tool);
    if (parsed === null) return null;
    systemTools.push(parsed);
  }
  const blocked = parseBlocked(value['blocked']);
  if (blocked === null) return null;
  const degradedRaw = value['degraded'];
  let degraded: string[] | undefined;
  if (degradedRaw !== undefined) {
    if (!Array.isArray(degradedRaw) || degradedRaw.some((note) => typeof note !== 'string')) return null;
    degraded = degradedRaw as string[];
  }
  return {
    sessionId,
    skills,
    mcp,
    systemTools,
    blocked,
    ...(degraded === undefined ? {} : { degraded }),
  };
}
