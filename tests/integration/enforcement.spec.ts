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

function bootHost() {
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
        { name: 'read', description: 'read a file' },
        { name: 'mcp__doubao-search__web_search', description: 'search' },
      ],
      guard(callback: Guard) {
        guard = callback;
        return () => {};
      },
    },
    sessionQuery: {
      readSession: () => Promise.resolve({ events: [] }),
      listEvents: () => Promise.resolve([]),
    },
    on(event: string, listener: unknown) {
      listeners[event] = listener;
    },
    effect(factory: () => (() => void) | void) {
      effects.push(factory);
    },
  };

  apply(ctx as never);
  for (const factory of effects) factory();

  const route = routes[0];
  if (route === undefined) throw new Error('route was never registered');
  return {
    route,
    waterfall: listeners['system-prompt/assemble'] as Waterfall,
    onResult: listeners['tools/result'] as ResultListener,
    getGuard: () => guard,
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
