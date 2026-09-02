/**
 * Runtime guards for the preset payload contract, shared so the client parser
 * and the composition tests exercise the exact same code. A rejected payload
 * must read as an error in the panel, not as an empty preset list -- the
 * host/client version skew that produces one (client hot-reloads, host needs
 * a restart) is exactly when shapes diverge.
 */
import type {
  PresetMcpServer,
  PresetSkillRow,
  PresetToolEntry,
  PresetToolPayload,
  PresetToolRow,
} from './preset-contract.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function parseTools(raw: readonly unknown[]): PresetToolRow[] | null {
  const tools: PresetToolRow[] = [];
  for (const rawTool of raw) {
    if (!isRecord(rawTool)) return null;
    const { name, label, description, enabled, reserved } = rawTool;
    if (typeof name !== 'string' || typeof label !== 'string' || typeof enabled !== 'boolean') return null;
    if (description !== undefined && typeof description !== 'string') return null;
    if (reserved !== undefined && typeof reserved !== 'boolean') return null;
    tools.push({
      name,
      label,
      ...(description === undefined ? {} : { description }),
      enabled,
      ...(reserved === undefined ? {} : { reserved }),
    });
  }
  return tools;
}

function parseSkills(raw: readonly unknown[]): PresetSkillRow[] | null {
  const skills: PresetSkillRow[] = [];
  for (const rawSkill of raw) {
    if (!isRecord(rawSkill)) return null;
    const { name, description, enabled, project } = rawSkill;
    if (typeof name !== 'string' || typeof enabled !== 'boolean') return null;
    if (description !== undefined && typeof description !== 'string') return null;
    if (project !== undefined && typeof project !== 'boolean') return null;
    skills.push({
      name,
      ...(description === undefined ? {} : { description }),
      enabled,
      ...(project === undefined ? {} : { project }),
    });
  }
  return skills;
}

/** Parse one payload, returning null for anything that is not the contract. */
export function parsePresetToolPayload(value: unknown): PresetToolPayload | null {
  if (!isRecord(value)) return null;
  const { presets: rawPresets, writable } = value;
  if (!Array.isArray(rawPresets) || typeof writable !== 'boolean') return null;
  const presets: PresetToolEntry[] = [];
  for (const raw of rawPresets) {
    if (!isRecord(raw)) return null;
    const { id, name, description, broken, trust, skills: rawSkills, mcp: rawMcp, systemTools: rawSystem } = raw;
    if (typeof id !== 'string' || typeof name !== 'string' || (trust !== 'system' && trust !== 'user')) return null;
    if (!Array.isArray(rawMcp) || !Array.isArray(rawSystem) || !Array.isArray(rawSkills)) return null;
    if (description !== undefined && typeof description !== 'string') return null;
    if (broken !== undefined && typeof broken !== 'string') return null;
    const systemTools = parseTools(rawSystem);
    if (systemTools === null) return null;
    const skills = parseSkills(rawSkills);
    if (skills === null) return null;
    const mcp: PresetMcpServer[] = [];
    for (const rawServer of rawMcp) {
      if (!isRecord(rawServer)) return null;
      const { server, tools: rawTools, enabled } = rawServer;
      if (typeof server !== 'string' || typeof enabled !== 'boolean' || !Array.isArray(rawTools)) return null;
      const tools = parseTools(rawTools);
      if (tools === null) return null;
      mcp.push({ server, tools, enabled });
    }
    presets.push({
      id,
      name,
      ...(description === undefined ? {} : { description }),
      ...(broken === undefined ? {} : { broken }),
      trust,
      skills,
      mcp,
      systemTools,
    });
  }
  return { presets, writable };
}
