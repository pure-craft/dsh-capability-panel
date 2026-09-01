import type { IncomingLike as BaseIncomingLike } from '../loopback.js';

export type CapabilityKind = 'skill' | 'mcp-server' | 'mcp-tool' | 'system-tool';

export interface SessionCapabilityState {
  readonly skills: Map<string, () => void>;
  readonly mcpServers: Map<string, () => void>;
  readonly mcpTools: Map<string, () => void>;
  readonly systemTools: Map<string, () => void>;
  noteDispose?: () => void;
}

export interface AgentsService {
  get(sessionId: string): AgentLike | undefined;
}

export interface AgentPresetLike {
  readonly id: string;
  readonly trust: 'system' | 'user';
  readonly name?: string;
  readonly description?: string;
  readonly broken?: string;
}

export interface AgentPresetsService {
  list(): Promise<AgentPresetLike[]>;
  standingKeyFor(id?: string): Promise<unknown>;
  composedPreset(agentCtx: unknown): string | undefined;
}

export interface PresetToolSettings {
  readonly presets: Readonly<Record<string, readonly string[]>>;
  /**
   * Disabled skills, keyed by preset id. Kept in its own map rather than mixed
   * into `presets`: skill names and tool names are separate namespaces, and a
   * single list could not say which registry a stored name belonged to.
   */
  readonly presetSkills: Readonly<Record<string, readonly string[]>>;
}

export interface SettingsScopeLike<T> {
  get(): T;
  /**
   * Wholesale replacement of this namespace's user section. The merge behind
   * `update` recurses, so it cannot remove a key; removal is why this is the
   * write path used here.
   */
  replace(section: object): Promise<void>;
}

export interface SettingsService {
  readonly writable: boolean;
  register<T>(namespace: string, schema: unknown, options?: { applies?: 'live' | 'restart' }): SettingsScopeLike<T>;
}

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
   * root. Such a row is real but conditional — a session opened elsewhere will
   * not see it — so the UI marks it instead of hiding it.
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

export interface SkillsService {
  list(lookup: { cwd?: string; scope?: unknown }): Promise<readonly SkillSummary[]>;
  get(name: string, lookup: { cwd?: string; scope?: unknown }): Promise<SkillDefinitionLike | undefined>;
}

export interface ToolsService {
  schemas(scope?: unknown): Iterable<{ name?: unknown; description?: unknown }>;
  guard?(guard: (execution: { name?: unknown; agent?: { id?: unknown } }) => string | undefined): () => void;
}

export interface SessionQueryService {
  readSession(sessionId: string): Promise<{ readonly events?: unknown }>;
  listEvents(sessionId: string): Promise<unknown>;
}

/** The `agent/created` payload, named so a listener wrapper can restate it. */
export interface AgentCreatedPayload {
  readonly agent: AgentLike & { readonly ctx: { get(name: 'tools'): ScopedToolsRegistry | undefined } };
}

export interface HostServices {
  readonly webServer?: {
    register(spec: {
      kind: 'prefix';
      path: string;
      handler: (req: IncomingLike, res: ServerResponseLike) => Promise<void> | void;
    }): () => void;
  };
  get(name: 'agents'): AgentsService | undefined;
  get(name: 'agentPresets'): AgentPresetsService | undefined;
  get(name: 'settings'): SettingsService | undefined;
  get(name: 'skills'): SkillsService | undefined;
  get(name: 'tools'): ToolsService | undefined;
  get(name: 'sessionQuery'): SessionQueryService | undefined;
  on(
    event: 'agent/created',
    /**
     * A returned promise is allowed on purpose. Cordis vetoes agent publication
     * on a SYNCHRONOUS listener failure but only reports a rejected promise, so
     * asynchronous work here cannot cost the user their session. The synchronous
     * part of a listener still has to contain its own failures.
     */
    listener: (payload: AgentCreatedPayload) => void | Promise<void>,
  ): void;
  on(
    event: 'tools/result',
    listener: (
      exec: { name?: unknown; arguments?: unknown; agent?: { id?: unknown } },
      result: { isError: boolean; error?: { message?: unknown; info?: { code?: unknown } } },
    ) => void,
  ): void;
  on(
    event: 'system-prompt/assemble',
    listener: (
      assembly: { tools?: readonly { name?: unknown }[] },
      context: { agent?: { id?: unknown } },
      next: () => Promise<{ tools?: readonly { name?: unknown }[] }>,
    ) => Promise<{ tools?: readonly { name?: unknown }[] }>,
  ): void;
  effect(factory: () => (() => void) | void, label?: string): void;
}

export interface ScopedSkillsRegistry {
  register(skill: {
    name: string;
    description: string;
    content: string;
    source: string;
    provider?: string;
    resourceBase?: unknown;
    invocation?: { modelInvocable: boolean; userInvocable: boolean };
  }): () => void;
}

export interface ScopedSystemPrompt {
  context(context: { name: string; order: number; text: () => string }): () => void;
}

export interface ScopedToolsRegistry {
  restrict(filter: { deny: readonly string[] }): () => void;
}

export interface AgentLike {
  readonly session?: { readonly header?: { readonly cwd?: string } };
  readonly ctx?: { get(name: string): unknown };
}

export interface SkillSummary {
  readonly name?: unknown;
  readonly description?: unknown;
  readonly invocation?: { readonly modelInvocable?: unknown };
}

export interface SkillDefinitionLike {
  readonly name?: unknown;
  readonly description?: unknown;
  readonly content?: unknown;
  readonly resourceBase?: unknown;
}

export interface IncomingLike extends BaseIncomingLike {
  on?(event: 'data', listener: (chunk: unknown) => void): void;
  on?(event: 'end', listener: () => void): void;
  on?(event: 'error', listener: (error: unknown) => void): void;
}

export interface ServerResponseLike {
  writeHead(status: number, headers: Record<string, string>): void;
  end(body?: string): void;
}
