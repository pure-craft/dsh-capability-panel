/**
 * Two things that only matter when something else changes: the prompt context
 * that tells the model what the user switched off, and the teardown that
 * releases every mask when the plugin unloads. A leaked mask would outlive the
 * plugin and silently keep a tool hidden with no panel left to restore it.
 */
import { describe, expect, it } from 'vitest';
import { apply } from '../../src/index.js';

type Handler = (req: unknown, res: unknown) => Promise<void> | void;

interface Recording {
  contexts: { name: string; order?: number; text: () => string }[];
  disposedMasks: number;
  disposedContexts: number;
}

function bootHost({ withSystemPrompt = true }: { withSystemPrompt?: boolean } = {}) {
  const routes: { path: string; handler: Handler }[] = [];
  const effects: (() => (() => void) | void)[] = [];
  const teardowns: (() => void)[] = [];
  const rec: Recording = { contexts: [], disposedMasks: 0, disposedContexts: 0 };

  const scopedTools = {
    restrict: () => () => {
      rec.disposedMasks += 1;
    },
  };
  const scopedSkills = {
    register: () => () => {
      rec.disposedMasks += 1;
    },
  };
  const scopedSystemPrompt = {
    context(entry: { name: string; order?: number; text: () => string }) {
      rec.contexts.push(entry);
      return () => {
        rec.disposedContexts += 1;
      };
    },
  };

  const ctx = {
    webServer: {
      register(spec: { path: string; handler: Handler }) {
        routes.push(spec);
        return () => {};
      },
    },
    agents: {
      get: () => ({
        id: 'agent-1',
        ctx: {
          get: (name: string) => {
            if (name === 'tools') return scopedTools;
            if (name === 'skills') return scopedSkills;
            if (name === 'systemPrompt') return withSystemPrompt ? scopedSystemPrompt : undefined;
            return undefined;
          },
        },
        session: { header: { cwd: '/tmp/session' } },
      }),
    },
    skills: {
      list: () => Promise.resolve([{ name: 'find-skills', description: 'd' }]),
      get: (name: string) => Promise.resolve({ name, description: 'd', content: 'c' }),
    },
    tools: {
      schemas: () => [
        { name: 'bash', description: 'run a shell command' },
        { name: 'mcp__doubao-search__web_search', description: 'search' },
        { name: 'mcp__doubao-search__image_search', description: 'images' },
      ],
      guard: () => () => {},
    },
    sessionQuery: {
      readSession: () => Promise.resolve({ events: [] }),
      listEvents: () => Promise.resolve([]),
    },
    on: () => {},
    effect(factory: () => (() => void) | void) {
      effects.push(factory);
    },
    get(name: string): unknown {
      return (ctx as unknown as Record<string, unknown>)[name];
    },
  };

  apply(ctx as never);
  for (const factory of effects) {
    const teardown = factory();
    if (typeof teardown === 'function') teardowns.push(teardown);
  }

  const route = routes[0];
  if (route === undefined) throw new Error('route was never registered');
  return { route, rec, teardownAll: () => { for (const teardown of teardowns) teardown(); } };
}

async function disable(handler: Handler, kind: string, name: string, session = 's1'): Promise<void> {
  const req = {
    method: 'POST',
    url: `/api/agent-toolkit?session=${session}`,
    headers: { host: '127.0.0.1:3080', 'content-type': 'application/json' },
    socket: { remoteAddress: '127.0.0.1' },
    on(event: string, listener: (chunk?: unknown) => void) {
      if (event === 'data') (this as { _data?: (chunk: unknown) => void })._data = listener;
      if (event === 'end') {
        (this as { _data?: (chunk: unknown) => void })._data?.(JSON.stringify({ kind, name, enabled: false }));
        listener();
      }
      return req;
    },
  };
  let status = 0;
  let body = '';
  await handler(req, { writeHead(code: number) { status = code; }, end(chunk?: string) { body = chunk ?? ''; } });
  if (status !== 200) throw new Error(`toggle failed: ${body}`);
}

describe('the model is told what the user switched off', () => {
  it('registers the note once, not once per toggle', async () => {
    const host = bootHost();
    await disable(host.route.handler, 'system-tool', 'bash');
    await disable(host.route.handler, 'skill', 'find-skills');

    expect(host.rec.contexts).toHaveLength(1);
    expect(host.rec.contexts[0]?.name).toBe('agent-toolkit:disabled-capabilities');
  });

  it('renders the live state at assembly time, listing every kind', async () => {
    const host = bootHost();
    await disable(host.route.handler, 'skill', 'find-skills');
    await disable(host.route.handler, 'system-tool', 'bash');
    await disable(host.route.handler, 'mcp-server', 'doubao-search');
    await disable(host.route.handler, 'mcp-tool', 'mcp__doubao-search__web_search');

    // `text` is a function precisely so it reflects the maps as they are now.
    const text = host.rec.contexts[0]?.text() ?? '';
    expect(text).toContain('find-skills');
    expect(text).toContain('bash');
    expect(text).toContain('doubao-search');
  });

  it('renders nothing once everything is switched back on', async () => {
    const host = bootHost();
    await disable(host.route.handler, 'system-tool', 'bash');
    const render = host.rec.contexts[0]?.text;
    expect(render?.()).toContain('bash');

    // Re-enable through the same route the panel uses.
    const req = {
      method: 'POST',
      url: '/api/agent-toolkit?session=s1',
      headers: { host: '127.0.0.1:3080', 'content-type': 'application/json' },
      socket: { remoteAddress: '127.0.0.1' },
      on(event: string, listener: (chunk?: unknown) => void) {
        if (event === 'data') (this as { _data?: (chunk: unknown) => void })._data = listener;
        if (event === 'end') {
          (this as { _data?: (chunk: unknown) => void })._data?.(
            JSON.stringify({ kind: 'system-tool', name: 'bash', enabled: true }),
          );
          listener();
        }
        return req;
      },
    };
    await host.route.handler(req, { writeHead() {}, end() {} });

    expect(render?.()).toBe('');
  });

  it('works when the agent exposes no system-prompt scope', async () => {
    // An older host without the scope must still switch capabilities; only
    // the explanatory note is lost.
    const host = bootHost({ withSystemPrompt: false });
    await disable(host.route.handler, 'system-tool', 'bash');

    expect(host.rec.contexts).toHaveLength(0);
  });
});

describe('teardown releases every mask', () => {
  it('disposes masks and the note when the plugin unloads', async () => {
    const host = bootHost();
    await disable(host.route.handler, 'skill', 'find-skills');
    await disable(host.route.handler, 'system-tool', 'bash');
    await disable(host.route.handler, 'mcp-server', 'doubao-search');
    await disable(host.route.handler, 'mcp-tool', 'mcp__doubao-search__web_search');
    expect(host.rec.disposedMasks).toBe(0);

    host.teardownAll();

    // Four masks plus the note: nothing may outlive the plugin, or a tool
    // would stay hidden with no panel left to restore it.
    expect(host.rec.disposedMasks).toBe(4);
    expect(host.rec.disposedContexts).toBe(1);
  });

  it('is safe when nothing was ever switched off', () => {
    const host = bootHost();
    expect(() => { host.teardownAll(); }).not.toThrow();
  });
});
