/**
 * Text filter over one preset's tools, kept a pure function for the same
 * reason `filterPayload` is: the matching rules stay unit-testable without a
 * DOM, and the section component stays a projection of state.
 *
 * The rules deliberately mirror the session panel so the two scopes behave
 * identically under the same query:
 * - MCP server: a hit on the server name keeps ALL of its tools (the match is
 *   the server's identity); otherwise only matching tools survive, and a
 *   server left with none drops out;
 * - system tool: label, full wire name, or description.
 */
import type { PresetMcpView, PresetToolPresetView, PresetToolView } from './preset-store.js';

export interface FilteredPreset {
  readonly mcp: readonly PresetMcpView[];
  readonly systemTools: readonly PresetToolView[];
  /** Visible top-level rows (server + system tool), for the summary line. */
  readonly total: number;
}

const hit = (query: string, fields: readonly (string | undefined)[]): boolean =>
  fields.some((field) => field !== undefined && field.toLowerCase().includes(query));

export function filterPreset(preset: PresetToolPresetView, rawQuery: string): FilteredPreset {
  const query = rawQuery.trim().toLowerCase();
  if (query === '') {
    return {
      mcp: preset.mcp,
      systemTools: preset.systemTools,
      total: preset.mcp.length + preset.systemTools.length,
    };
  }
  const mcp = preset.mcp.flatMap((server) => {
    if (hit(query, [server.server])) return [server];
    const tools = server.tools.filter((tool) => hit(query, [tool.label, tool.name, tool.description]));
    return tools.length > 0 ? [{ ...server, tools }] : [];
  });
  const systemTools = preset.systemTools.filter((tool) =>
    hit(query, [tool.label, tool.name, tool.description]),
  );
  return { mcp, systemTools, total: mcp.length + systemTools.length };
}
