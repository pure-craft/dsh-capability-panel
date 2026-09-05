/**
 * The three execution points where a mask actually takes effect: the
 * system-prompt waterfall (the model never sees a masked tool), the tool guard
 * (a masked tool is denied even if the model asks anyway), and the result
 * listener (a denial is counted). A mask that only shows in the panel would
 * be a lie, so these are asserted against the real callbacks `apply()`
 * registers rather than through the HTTP surface alone.
 */
import { describe, expect, it } from 'vitest';
import { apply } from '../../src/index.js';

type Handler = (req: unknown, res: unknown) => Promise<void> | void;
type Waterfall = (assembly: unknown, context: unknown, next: () => Promise<unknown>) => Promise<unknown>;
type Guard = (execution: unknown) => string | undefined;
type ResultListener = (execution: unknown, result: unknown) => void;

function bootHost(options: { schemas?: { name: string; description: string }[]; startWithoutTools?: boolean } = {}) {
  const routes: { path: string; handler: Handler }[] = [];
  const effects: (() => (() => void) | void)[] = [];
  const listeners: Record<string, unknown> = {};
  let guard: Guard | undefined;

  const scopedTools = { restrict: () => () => {} };
  const scopedSkills = { register: () => () => {} };

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
          get: (name: string) => (name === 'tools' ? scopedTools : name === 'skills' ? scopedSkills : undefined),
        },
        session: {
            header: { cwd: '/tmp/session' },
            snapshotEvents: () => [],
            surface: { nodes: [] },
          },
      }),
    },
    skills: {
      list: () => Promise.resolve([{ name: 'find-skills', description: 'd' }]),
      get: (name: string) => Promise.resolve({ name, description: 'd', content: 'c' }),
    },
    tools: {
      schemas: () =>
        options.schemas ?? [
          { name: 'bash', description: 'run a shell command' },
          { name: 'read', description: 'read a file' },
          { name: 'mcp__doubao-search__web_search', description: 'search' },
        ],
      guard(callback: Guard) {
        guard = callback;
        return () => {};
      },
    },
    on(event: string, listener: unknown) {
      listeners[event] = listener;
    },
    effect(factory: () => (() => void) | void) {
      effects.push(factory);
    },
    get(name: string): unknown {
      return (ctx as unknown as Record<string, unknown>)[name];
    },
  };

  const toolService = ctx.tools;
  if (options.startWithoutTools === true) delete (ctx as Partial<typeof ctx>).tools;
  apply(ctx as never);
  for (const factory of effects) factory();

  const route = routes[0];
  if (route === undefined) throw new Error('route was never registered');
  return {
    route,
    waterfall: listeners['system-prompt/assemble'] as Waterfall,
    onResult: listeners['tools/result'] as ResultListener,
    getGuard: () => guard,
    toolService,
    /** The fake context itself, so a test can vanish or restore a service mid-session. */
    ctx: ctx as Record<string, unknown>,
  };
}

/** Mask one capability for a session through the real route. */
async function disable(handler: Handler, kind: string, name: string, session = 's1'): Promise<void> {
  const req = {
    method: 'POST',
    url: `/api/agent-toolkit?session=${session}`,
    headers: { host: '127.0.0.1:3080', 'content-type': 'application/json' },
    socket: { remoteAddress: '127.0.0.1' },
    on(event: string, listener: (chunk?: unknown) => void) {
      if (event === 'end') {
        // Deliver the whole body, then close, the way a small POST arrives.
        (this as { _data?: (chunk: unknown) => void })._data?.(
          JSON.stringify({ kind, name, enabled: false }),
        );
        listener();
      }
      if (event === 'data') (this as { _data?: (chunk: unknown) => void })._data = listener;
      return req;
    },
  };
  let status = 0;
  let body = '';
  const res = { writeHead(code: number) { status = code; }, end(chunk?: string) { body = chunk ?? ''; } };
  await handler(req, res);
  if (status !== 200) throw new Error(`toggle failed: ${body}`);
}

/** GET the stats endpoint and parse the body. */
async function readStatsBody(handler: Handler): Promise<{ blocked: Record<string, number> }> {
  let body = '';
  const req = {
    method: 'GET',
    url: '/api/agent-toolkit/stats',
    headers: { host: '127.0.0.1:3080' },
    socket: { remoteAddress: '127.0.0.1' },
    on: () => req,
  };
  await handler(req, { writeHead() {}, end(chunk?: string) { body = chunk ?? ''; } });
  return JSON.parse(body) as { blocked: Record<string, number> };
}

describe('the system-prompt waterfall hides a masked tool', () => {
  it('removes exactly the masked tool from the assembled list', async () => {
    const host = bootHost();
    await disable(host.route.handler, 'system-tool', 'bash');

    const assembled = { tools: [{ name: 'bash' }, { name: 'read' }] };
    const result = (await host.waterfall({}, { agent: { id: 's1' } }, () =>
      Promise.resolve(assembled))) as { tools: { name: string }[] };

    expect(result.tools.map((tool) => tool.name)).toEqual(['read']);
  });

  it('leaves the assembly untouched for a session with no masks', async () => {
    const host = bootHost();
    const assembled = { tools: [{ name: 'bash' }] };
    const result = await host.waterfall({}, { agent: { id: 'other' } }, () => Promise.resolve(assembled));

    expect(result).toBe(assembled);
  });

  it('leaves the assembly untouched when no agent is attached', async () => {
    const host = bootHost();
    const assembled = { tools: [{ name: 'bash' }] };

    expect(await host.waterfall({}, {}, () => Promise.resolve(assembled))).toBe(assembled);
    expect(await host.waterfall({}, { agent: { id: 42 } }, () => Promise.resolve(assembled))).toBe(assembled);
  });

  it('leaves an assembly that carries no tools at all', async () => {
    const host = bootHost();
    await disable(host.route.handler, 'system-tool', 'bash');
    const assembled = { tools: undefined };

    expect(await host.waterfall({}, { agent: { id: 's1' } }, () => Promise.resolve(assembled))).toBe(assembled);
  });
});

describe('the guard denies a masked tool that is called anyway', () => {
  it('registers the guard lazily when tools appear after startup', async () => {
    const host = bootHost({ startWithoutTools: true });
    expect(host.getGuard()).toBeUndefined();
    host.ctx['tools'] = host.toolService;

    await disable(host.route.handler, 'system-tool', 'bash');
    expect(host.getGuard()?.({ agent: { id: 's1' }, name: 'bash' })).toContain('bash');
  });

  it('denies with a message naming the tool and the way back', async () => {
    const host = bootHost();
    await disable(host.route.handler, 'system-tool', 'bash');

    const denial = host.getGuard()?.({ agent: { id: 's1' }, name: 'bash' });
    expect(denial).toContain('bash');
    expect(denial).toMatch(/re-enable/);
  });

  it('allows a tool that is not masked', () => {
    const host = bootHost();
    expect(host.getGuard()?.({ agent: { id: 's1' }, name: 'read' })).toBeUndefined();
  });

  it('allows everything for a session that masked nothing', () => {
    const host = bootHost();
    expect(host.getGuard()?.({ agent: { id: 'untouched' }, name: 'bash' })).toBeUndefined();
  });

  it('allows when the execution carries no agent or no tool name', async () => {
    const host = bootHost();
    await disable(host.route.handler, 'system-tool', 'bash');

    expect(host.getGuard()?.({ name: 'bash' })).toBeUndefined();
    expect(host.getGuard()?.({ agent: { id: 42 }, name: 'bash' })).toBeUndefined();
    expect(host.getGuard()?.({ agent: { id: 's1' } })).toBeUndefined();
  });
});

describe('denials are counted', () => {
  it('counts a guard denial against the tool that was blocked', async () => {
    const host = bootHost();
    await disable(host.route.handler, 'system-tool', 'bash');

    host.onResult(
      { agent: { id: 's1' }, name: 'bash' },
      { isError: true, error: { message: 'agent-toolkit: tool disabled "bash" (re-enable from the agent toolkit panel)' } },
    );

    // The count reaches the panel through the same payload the client reads.
    let body = '';
    const req = {
      method: 'GET',
      url: '/api/agent-toolkit?session=s1',
      headers: { host: '127.0.0.1:3080' },
      socket: { remoteAddress: '127.0.0.1' },
      on: () => req,
    };
    await host.route.handler(req, { writeHead() {}, end(chunk?: string) { body = chunk ?? ''; } });

    expect((JSON.parse(body) as { blocked: Record<string, number> }).blocked['bash']).toBe(1);
  });

  it('ignores a successful call', () => {
    const host = bootHost();
    expect(() => { host.onResult({ agent: { id: 's1' }, name: 'bash' }, {}); }).not.toThrow();
  });
});

describe('the result listener ignores what it should', () => {
  it('ignores a result with no agent attached', async () => {
    const host = bootHost();
    await disable(host.route.handler, 'system-tool', 'bash');

    expect(() => { host.onResult({ name: 'bash' }, { isError: true, error: { message: 'x' } }); }).not.toThrow();
    expect(() => { host.onResult({ agent: { id: 42 }, name: 'bash' }, { isError: true, error: {} }); }).not.toThrow();
  });

  it('ignores a session that never switched anything off', () => {
    const host = bootHost();
    expect(() => {
      host.onResult({ agent: { id: 'untouched' }, name: 'bash' }, { isError: true, error: { message: 'x' } });
    }).not.toThrow();
  });

  it('does not count an error unrelated to a mask', async () => {
    const host = bootHost();
    await disable(host.route.handler, 'system-tool', 'bash');
    // A tool that failed on its own merits is not a blocked attempt.
    host.onResult(
      { agent: { id: 's1' }, name: 'read' },
      { isError: true, error: { message: 'ENOENT: no such file' } },
    );

    let body = '';
    const req = {
      method: 'GET',
      url: '/api/agent-toolkit?session=s1',
      headers: { host: '127.0.0.1:3080' },
      socket: { remoteAddress: '127.0.0.1' },
      on: () => req,
    };
    await host.route.handler(req, { writeHead() {}, end(chunk?: string) { body = chunk ?? ''; } });

    expect((JSON.parse(body) as { blocked: Record<string, number> }).blocked['read']).toBeUndefined();
  });

  it('handles a failed result that carries no error object', async () => {
    const host = bootHost();
    await disable(host.route.handler, 'system-tool', 'bash');

    expect(() => { host.onResult({ agent: { id: 's1' }, name: 'bash' }, { isError: true }); }).not.toThrow();
  });
});

describe('disabledToolNames under a shifting host', () => {
  it('expands a server mask only over servers that are actually masked', async () => {
    // Two servers in the global view, one masked: the expansion must skip the
    // unmasked server's tools, or an unrelated server would count as blocked.
    const host = bootHost({ schemas: [
      { name: 'mcp__alpha__search', description: 'a' },
      { name: 'mcp__beta__search', description: 'b' },
    ] });
    await disable(host.route.handler, 'mcp-server', 'alpha');
    host.onResult(
      { agent: { id: 's1' }, name: 'mcp__beta__search' },
      { isError: true, error: { info: { code: 'UNKNOWN_TOOL' }, message: 'unknown tool' } },
    );

    const body = await readStatsBody(host.route.handler);
    expect(body.blocked['mcp__beta__search']).toBeUndefined();
  });

  it('still counts direct masks when the tools service disappears mid-session', async () => {
    // ctx.get is read per call, so a service vanishing between the toggle and
    // a later result event must not throw — the server expansion silently
    // cannot run, but direct single-tool masks still classify.
    const host = bootHost({
      schemas: [
        { name: 'mcp__alpha__search', description: 'a' },
        { name: 'mcp__alpha__read', description: 'a2' },
      ],
    });
    await disable(host.route.handler, 'mcp-server', 'alpha');
    await disable(host.route.handler, 'mcp-tool', 'mcp__alpha__search');
    // Only now does the service vanish: masks are already in place, and the
    // next result event must classify against them without the global view.
    host.ctx['tools'] = undefined;

    host.onResult(
      { agent: { id: 's1' }, name: 'mcp__alpha__search' },
      { isError: true, error: { info: { code: 'UNKNOWN_TOOL' }, message: 'unknown tool' } },
    );

    const body = await readStatsBody(host.route.handler);
    expect(body.blocked['mcp__alpha__search']).toBe(1);
  });
});
