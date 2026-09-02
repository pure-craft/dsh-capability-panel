/**
 * The preset defaults payload, shared verbatim between the host that produces
 * it and the client that renders it. This module is types-only; the runtime
 * guards live in `preset-wire.ts`, mirroring how `contract.ts` and `wire.ts`
 * split the session payload. Types defined twice -- once per half -- were the
 * state of the world before this module, and the two copies had to be kept in
 * sync by hand.
 */

/** One switchable tool, shaped like the session panel's `ToolEntry`. */
export interface PresetToolRow {
  readonly name: string;
  readonly label: string;
  readonly description?: string;
  readonly enabled: boolean;
  readonly reserved?: boolean;
}

/** MCP tools grouped by server, mirroring the session panel's `McpServerEntry`. */
export interface PresetMcpServer {
  readonly server: string;
  readonly tools: readonly PresetToolRow[];
  /** False only when every tool this server exposes is disabled. */
  readonly enabled: boolean;
}

/**
 * One switchable skill. Unlike a tool, a skill can enter the catalog from a
 * project root, so its visibility depends on where a session opens.
 */
export interface PresetSkillRow {
  readonly name: string;
  readonly description?: string;
  readonly enabled: boolean;
  /**
   * True when this skill was discovered under the reading workspace's project
   * root. Such a row is real but conditional -- a session opened elsewhere will
   * not see it -- so the UI marks it instead of hiding it.
   */
  readonly project?: boolean;
}

export interface PresetToolEntry {
  readonly id: string;
  readonly name: string;
  readonly trust: 'system' | 'user';
  readonly description?: string;
  readonly broken?: string;
  /**
   * Skills this preset can see from the reading process's workspace. Ordered
   * before the tool groups because a skill is the coarser capability.
   */
  readonly skills: readonly PresetSkillRow[];
  /**
   * Split the same way the session panel splits its own tools, so one filter
   * and one row renderer serve both scopes: a preset carrying 200 MCP tools
   * collapses to a handful of server rows instead of one flat list.
   */
  readonly mcp: readonly PresetMcpServer[];
  readonly systemTools: readonly PresetToolRow[];
}

export interface PresetToolPayload {
  readonly presets: readonly PresetToolEntry[];
  readonly writable: boolean;
}
