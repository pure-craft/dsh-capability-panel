import type { IncomingLike as BaseIncomingLike } from '../loopback.js';

export type CapabilityKind = 'skill' | 'mcp-server' | 'mcp-tool' | 'system-tool';

export interface SessionCapabilityState {
  readonly skills: Map<string, () => void>;
  readonly mcpServers: Map<string, () => void>;
  readonly mcpTools: Map<string, () => void>;
  readonly systemTools: Map<string, () => void>;
  /**
   * `${kind}:${name}` keys the user flipped through the panel while this
   * state exists. A restore replaying persisted positions must skip these:
   * the user's live action is newer than anything on disk, and re-applying
   * the stored position would silently diverge memory from the record.
   */
  readonly userToggled: Set<string>;
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

/**
 * One session's persisted switch positions, keyed by capability kind. A name
 * maps to the user's final toggle: false = masked for this session, true =
 * explicitly re-enabled (which is what lets a session override a preset
 * default across a restart). Session-bound: restored only into the session
 * whose id keys the entry, never applied to another session.
 */
export interface SessionOverrideState {
  readonly skills: Readonly<Record<string, boolean>>;
  readonly mcpServers: Readonly<Record<string, boolean>>;
  readonly mcpTools: Readonly<Record<string, boolean>>;
  readonly systemTools: Readonly<Record<string, boolean>>;
}

export interface ToolkitSettings {
  readonly presets: Readonly<Record<string, readonly string[]>>;
  /**
   * Disabled skills, keyed by preset id. Kept in its own map rather than mixed
   * into `presets`: skill names and tool names are separate namespaces, and a
   * single list could not say which registry a stored name belonged to.
   */
  readonly presetSkills: Readonly<Record<string, readonly string[]>>;
  /** Session-bound switch positions, keyed by session id. */
  readonly sessions: Readonly<Record<string, SessionOverrideState>>;
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

export type {
  PresetMcpServer,
  PresetSkillRow,
  PresetToolEntry,
  PresetToolPayload,
  PresetToolRow,
} from '../preset-contract.js';

export interface SkillsService {
  list(lookup: { cwd?: string; scope?: unknown }): Promise<readonly SkillSummary[]>;
  get(name: string, lookup: { cwd?: string; scope?: unknown }): Promise<SkillDefinitionLike | undefined>;
}

export interface ToolsService {
  schemas(scope?: unknown): Iterable<{ name?: unknown; description?: unknown }>;
  guard?(guard: (execution: { name?: unknown; agent?: { id?: unknown } }) => string | undefined): () => void;
}

/** The `agent/created` payload, named so a listener wrapper can restate it. */
export interface AgentCreatedPayload {
  readonly agent: AgentLike & {
    readonly id?: unknown;
    readonly ctx: { get(name: 'tools'): ScopedToolsRegistry | undefined };
  };
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
  readonly session?: {
    readonly header?: { readonly cwd?: string };
    /**
     * Live in-memory log view, present on every real Session. Borrowed
     * references, zero-copy — the panel scans this instead of asking a query
     * service to clone and replay-validate the whole log.
     */
    readonly snapshotEvents?: () => readonly unknown[];
    /** Incrementally maintained current surface: seqs the model sees now. */
    readonly surface?: { readonly nodes?: readonly unknown[] };
  };
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
