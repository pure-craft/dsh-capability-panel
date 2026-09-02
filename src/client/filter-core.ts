/**
 * Panel text filter as a pure function over a capability set, so the matching
 * rules are unit-testable without a DOM and each component stays a projection.
 *
 * Matching rules (case-insensitive substring, query trimmed):
 * - skill: name or description;
 * - MCP server: server name keeps ALL of its tools (the match is the server's
 *   identity); otherwise only the matching tools survive and a server with no
 *   surviving tools drops out;
 * - system tool: label, full name, or description.
 *
 * Both panels share this one implementation rather than a copy each. They are
 * required to behave identically under the same query -- two scopes of one
 * feature -- and a copy maintained by hand is how that requirement quietly
 * stops being true.
 *
 * Each caller keeps its own payload types: the generics below name only the
 * fields matching reads, so a skill carrying `state` and one carrying
 * `project` both satisfy them and neither shape leaks into the other panel.
 */

/** The fields a skill row is matched on. */
export interface MatchableSkill {
  readonly name: string;
  readonly description?: string;
}

/** The fields a tool row is matched on, for system tools and MCP tools alike. */
export interface MatchableTool {
  readonly name: string;
  readonly label: string;
  readonly description?: string;
}

/** An MCP server and the tools nested under it. */
export interface MatchableServer<Tool extends MatchableTool> {
  readonly server: string;
  readonly tools: readonly Tool[];
}

export interface Capabilities<
  Skill extends MatchableSkill,
  Tool extends MatchableTool,
  Server extends MatchableServer<Tool>,
> {
  readonly skills: readonly Skill[];
  readonly mcp: readonly Server[];
  readonly systemTools: readonly Tool[];
}

export interface FilteredCapabilities<
  Skill extends MatchableSkill,
  Tool extends MatchableTool,
  Server extends MatchableServer<Tool>,
> {
  readonly skills: readonly Skill[];
  readonly mcp: readonly Server[];
  readonly systemTools: readonly Tool[];
  /** Visible top-level rows (skill + server + system tool), for the summary. */
  readonly total: number;
}

const hit = (query: string, fields: readonly (string | undefined)[]): boolean =>
  fields.some((field) => field !== undefined && field.toLowerCase().includes(query));

export function filterCapabilities<
  Skill extends MatchableSkill,
  Tool extends MatchableTool,
  Server extends MatchableServer<Tool>,
>(source: Capabilities<Skill, Tool, Server>, rawQuery: string): FilteredCapabilities<Skill, Tool, Server> {
  const query = rawQuery.trim().toLowerCase();
  if (query === '') {
    return {
      skills: source.skills,
      mcp: source.mcp,
      systemTools: source.systemTools,
      total: source.skills.length + source.mcp.length + source.systemTools.length,
    };
  }
  const skills = source.skills.filter((skill) => hit(query, [skill.name, skill.description]));
  const mcp = source.mcp.flatMap((server) => {
    if (hit(query, [server.server])) return [server];
    const tools = server.tools.filter((tool) => hit(query, [tool.label, tool.name, tool.description]));
    return tools.length > 0 ? [{ ...server, tools }] : [];
  });
  const systemTools = source.systemTools.filter((tool) =>
    hit(query, [tool.label, tool.name, tool.description]),
  );
  return { skills, mcp, systemTools, total: skills.length + mcp.length + systemTools.length };
}
