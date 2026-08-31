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

export interface HostServices {
  readonly webServer?: {
    register(spec: {
      kind: 'prefix';
      path: string;
      handler: (req: IncomingLike, res: ServerResponseLike) => Promise<void> | void;
    }): () => void;
  };
  get(name: 'agents'): AgentsService | undefined;
  get(name: 'skills'): SkillsService | undefined;
  get(name: 'tools'): ToolsService | undefined;
  get(name: 'sessionQuery'): SessionQueryService | undefined;
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
