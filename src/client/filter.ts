/**
 * Panel text filter as a pure function over the wire payload, so the matching
 * rules are unit-testable without a DOM and the component stays a projection.
 *
 * Matching rules (case-insensitive substring, query trimmed):
 * - skill: name or description;
 * - MCP server: server name keeps ALL of its tools (the match is the server's
 *   identity); otherwise only the matching tools survive and a server with no
 *   surviving tools drops out;
 * - system tool: label, full name, or description.
 *
 * The component force-expands detail panels while a query is active, so the
 * description a row matched on is visible without a second click.
 */
import type { InspectorPayload, McpServerEntry } from '../contract.js';

export interface FilteredPayload {
  readonly skills: InspectorPayload['skills'];
  readonly mcp: readonly McpServerEntry[];
  readonly systemTools: InspectorPayload['systemTools'];
  /** Visible top-level rows (skill + server + system tool), for the summary. */
  readonly total: number;
}

const hit = (query: string, fields: readonly (string | undefined)[]): boolean =>
  fields.some((field) => field !== undefined && field.toLowerCase().includes(query));

export function filterPayload(payload: InspectorPayload, rawQuery: string): FilteredPayload {
  const query = rawQuery.trim().toLowerCase();
  if (query === '') {
    return {
      skills: payload.skills,
      mcp: payload.mcp,
      systemTools: payload.systemTools,
      total: payload.skills.length + payload.mcp.length + payload.systemTools.length,
    };
  }
  const skills = payload.skills.filter((skill) => hit(query, [skill.name, skill.description]));
  const mcp = payload.mcp.flatMap((server) => {
    if (hit(query, [server.server])) return [server];
    const tools = server.tools.filter((tool) => hit(query, [tool.label, tool.name, tool.description]));
    return tools.length > 0 ? [{ ...server, tools }] : [];
  });
  const systemTools = payload.systemTools.filter((tool) =>
    hit(query, [tool.label, tool.name, tool.description]),
  );
  return { skills, mcp, systemTools, total: skills.length + mcp.length + systemTools.length };
}
