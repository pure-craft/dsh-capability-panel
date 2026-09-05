/**
 * The switch mechanism, driven through the real route. These are the paths
 * that actually change what the model can reach, so they are exercised end to
 * end — POST the toggle, then assert against the catalog the route serves
 * back and against the scoped registry calls the host made.
 */
import { describe, expect, it } from 'vitest';
import { apply } from '../../src/index.js';

type Handler = (req: unknown, res: unknown) => Promise<void> | void;

/** Everything the fake host recorded, so a toggle's real effect is assertable. */
interface Recording {
  restrictCalls: { deny: readonly string[] }[];
  restrictDisposed: number;
  registeredSkills: { name: string; invocation?: { modelInvocable: boolean; userInvocable: boolean } }[];
  skillDisposed: number;
}

function bootHost(overrides: Record<string, unknown> = {}) {
  const routes: { path: string; handler: Handler }[] = [];
  const effects: (() => (() => void) | void)[] = [];
  const rec: Recording = { restrictCalls: [], restrictDisposed: 0, registeredSkills: [], skillDisposed: 0 };

  const scopedTools = {
    schemas: () => [
      { name: 'bash' },
      { name: 'run_code' },
      { name: 'mcp__doubao-search__web_search' },
      { name: 'mcp__doubao-search__image_search' },
      { name: 'preset_only' },
    ],
    restrict(filter: { deny: readonly string[] }) {
      rec.restrictCalls.push(filter);
      return () => {
        rec.restrictDisposed += 1;
      };
    },
  };
  const scopedSkills = {
    register(entry: { name: string; invocation?: { modelInvocable: boolean; userInvocable: boolean } }) {
      rec.registeredSkills.push(entry);
      return () => {
        rec.skillDisposed += 1;
      };
    },
  };

  const base = {
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
      list: () => Promise.resolve([{ name: 'find-skills', description: 'discover skills' }]),
      get: (name: string) => Promise.resolve({ name, description: 'd', content: 'c' }),
    },
    tools: {
      schemas: (scope?: unknown) => [
        { name: 'bash', description: 'run a shell command' },
        { name: 'run_code', description: 'code mode transport' },
        { name: 'mcp__doubao-search__web_search', description: 'search the web' },
        { name: 'mcp__doubao-search__image_search', description: 'search images' },
        ...(scope === undefined ? [] : [{ name: 'preset_only', description: 'preset scoped tool' }]),
      ],
      guard: () => () => {},
    },
    on: () => {},
    effect(factory: () => (() => void) | void) {
      effects.push(factory);
    },
    get(name: string): unknown {
      return ctx[name];
    },
  };

  // An override set to `undefined` removes that service, which is how the
  // "service absent" cases are expressed; rebuild rather than delete keys.
  const merged: Record<string, unknown> = { ...base, ...overrides };
  const ctx: Record<string, unknown> = Object.fromEntries(
    Object.entries(merged).filter(([, value]) => value !== undefined),
  );

  apply(ctx as never);
  for (const factory of effects) factory();

  const route = routes[0];
  if (route === undefined) throw new Error('route was never registered');
  return { route, rec, ctx };
}

/** POST a capability toggle the way the client does. */
async function post(
  handler: Handler,
  body: unknown,
  { session = 's1', contentType = 'application/json' }: { session?: string | null; contentType?: string | null } = {},
): Promise<{ status: number; body: string }> {
  let status = 0;
  let out = '';
  const chunks = typeof body === 'string' ? body : JSON.stringify(body);
  const listeners: Record<string, (chunk?: unknown) => void> = {};
  const req = {
    method: 'POST',
    url: session === null ? '/api/agent-toolkit' : `/api/agent-toolkit?session=${session}`,
    headers: { host: '127.0.0.1:3080', ...(contentType === null ? {} : { 'content-type': contentType }) },
    socket: { remoteAddress: '127.0.0.1' },
    on(event: string, listener: (chunk?: unknown) => void) {
      listeners[event] = listener;
      // Deliver the body as soon as both handlers are attached.
      if (event === 'end') {
        listeners['data']?.(chunks);
        listener();
      }
      return req;
    },
  };
  const res = {
    writeHead(code: number) {
      status = code;
    },
    end(chunk?: string) {
      out = chunk ?? '';
    },
  };
  await handler(req, res);
  return { status, body: out };
}

/** Read the `error` string from a JSON error body without spreading `any`. */
function errorOf(body: string): string {
  const parsed: unknown = JSON.parse(body);
  if (parsed !== null && typeof parsed === 'object' && 'error' in parsed) {
    const { error: value } = parsed;
    if (typeof value === 'string') return value;
  }
  throw new Error(`expected an error body, got: ${body}`);
}

async function readCatalog(handler: Handler, session = 's1') {
  let body = '';
  const req = {
    method: 'GET',
    url: `/api/agent-toolkit?session=${session}`,
    headers: { host: '127.0.0.1:3080' },
    socket: { remoteAddress: '127.0.0.1' },
    on: () => req,
  };
  const res = { writeHead() {}, end(chunk?: string) { body = chunk ?? ''; } };
  await handler(req, res);
  return JSON.parse(body) as {
    skills: { name: string; enabled: boolean }[];
    mcp: { server: string; enabled: boolean; tools: { name: string; enabled: boolean }[] }[];
    systemTools: { name: string; enabled: boolean; reserved?: boolean }[];
  };
}

describe('request validation, before anything is switched', () => {
  it('refuses a body that is not declared JSON', async () => {
    // A form post (text/plain) is a simple request a cross-origin page could
    // send; rejecting on content-type stops it before the body is read.
    const { route } = bootHost();
    const { status, body } = await post(route.handler, { kind: 'skill', name: 'x', enabled: false }, {
      contentType: 'text/plain',
    });

    expect(status).toBe(415);
    expect(body).toBe('expected application/json');
  });

  it('refuses a request with no content-type at all', async () => {
    const { route } = bootHost();
    const { status } = await post(route.handler, { kind: 'skill', name: 'x', enabled: false }, { contentType: null });

    expect(status).toBe(415);
  });

  it('requires a session', async () => {
    const { route } = bootHost();
    const { status, body } = await post(route.handler, { kind: 'skill', name: 'x', enabled: false }, { session: null });

    expect(status).toBe(400);
    expect(errorOf(body)).toMatch(/session is required/);
  });

  it('rejects a body that is not an object', async () => {
    const { route } = bootHost();
    for (const bad of ['"a string"', '42', 'null']) {
      const { status, body } = await post(route.handler, bad);
      expect(status).toBe(400);
      expect(errorOf(body)).toMatch(/invalid request body/);
    }
  });

  it('rejects unparseable JSON', async () => {
    const { route } = bootHost();
    const { status } = await post(route.handler, '{not json');

    expect(status).toBe(400);
  });

  it('rejects an unknown kind or a non-boolean enabled flag', async () => {
    const { route } = bootHost();
    for (const bad of [
      { kind: 'plugin', name: 'x', enabled: false },
      { kind: 42, name: 'x', enabled: false },
      { kind: 'skill', name: 'x', enabled: 'no' },
    ]) {
      const { status, body } = await post(route.handler, bad);
      expect(status).toBe(400);
      expect(errorOf(body)).toMatch(/kind must be/);
    }
  });

  it('rejects a missing or empty name', async () => {
    const { route } = bootHost();
    for (const bad of [{ kind: 'skill', enabled: false }, { kind: 'skill', name: '', enabled: false }]) {
      const { status, body } = await post(route.handler, bad);
      expect(status).toBe(400);
      expect(errorOf(body)).toMatch(/name is required/);
    }
  });
});

describe('switching a skill', () => {
  it('registers a same-name shadow that the model cannot invoke', async () => {
    const { route, rec } = bootHost();
    const { status } = await post(route.handler, { kind: 'skill', name: 'find-skills', enabled: false });

    expect(status).toBe(200);
    // The shadow keeps the name and drops model invocation; `/find-skills`
    // stays available to the user.
    expect(rec.registeredSkills).toHaveLength(1);
    expect(rec.registeredSkills[0]?.name).toBe('find-skills');
    expect(rec.registeredSkills[0]?.invocation?.modelInvocable).toBe(false);
    // The user keeps `/find-skills`: only the model's access is withdrawn.
    expect(rec.registeredSkills[0]?.invocation?.userInvocable).toBe(true);
  });

  // A skill masked by the PRESET panel also carries modelInvocable: false, but
  // it is not in the session panel's own disabled set. If the read path treats
  // "not mine" as "not there", the row vanishes from the session panel and the
  // user cannot see, let alone re-enable, a skill their preset switched off.
  it('still lists a skill the preset layer masked', async () => {
    const { route } = bootHost({
      skills: {
        list: () =>
          Promise.resolve([
            { name: 'find-skills', description: 'discover skills' },
            {
              name: 'preset-masked',
              description: 'switched off by the preset',
              invocation: { modelInvocable: false, userInvocable: true },
            },
          ]),
        get: (name: string) => Promise.resolve({ name, description: 'd', content: 'c' }),
      },
    });
    const catalog = await readCatalog(route.handler);

    const row = catalog.skills.find((skill) => skill.name === 'preset-masked');
    expect(row, 'a preset-masked skill must remain visible in the session panel').toBeDefined();
    expect(row?.enabled).toBe(false);
  });

  // The tool list is the union of the global catalog and the agent's own
  // scope, so a tool the preset denied still appears -- correctly, since the
  // session panel can switch it back on. What it must not do is claim the tool
  // is currently reachable by the model.
  it('marks a tool the preset denied as off, not as available', async () => {
    const { route } = bootHost({
      tools: {
        schemas: (scope?: unknown) => [
          { name: 'bash', description: 'run a shell command' },
          { name: 'run_code', description: 'code mode transport' },
          // Present globally, withheld from this agent by the preset.
          ...(scope === undefined ? [{ name: 'preset_denied', description: 'denied by preset' }] : []),
        ],
        guard: () => () => {},
      },
    });
    const catalog = await readCatalog(route.handler);

    const row = catalog.systemTools.find((tool) => tool.name === 'preset_denied');
    expect(row, 'a preset-denied tool stays listed so the session can re-enable it').toBeDefined();
    expect(row?.enabled, 'but it must not be reported as reachable').toBe(false);
  });

  it('reports the skill as disabled in the catalog', async () => {
    const { route } = bootHost();
    await post(route.handler, { kind: 'skill', name: 'find-skills', enabled: false });
    const catalog = await readCatalog(route.handler);

    expect(catalog.skills.find((s) => s.name === 'find-skills')?.enabled).toBe(false);
  });

  it('disposes the shadow when re-enabled, letting the original win again', async () => {
    const { route, rec } = bootHost();
    await post(route.handler, { kind: 'skill', name: 'find-skills', enabled: false });
    await post(route.handler, { kind: 'skill', name: 'find-skills', enabled: true });

    expect(rec.skillDisposed).toBe(1);
    const catalog = await readCatalog(route.handler);
    expect(catalog.skills.find((s) => s.name === 'find-skills')?.enabled).toBe(true);
  });

  it('is idempotent: disabling twice registers one shadow', async () => {
    const { route, rec } = bootHost();
    await post(route.handler, { kind: 'skill', name: 'find-skills', enabled: false });
    await post(route.handler, { kind: 'skill', name: 'find-skills', enabled: false });

    expect(rec.registeredSkills).toHaveLength(1);
  });

  it('re-enabling something never disabled is a no-op', async () => {
    const { route, rec } = bootHost();
    const { status } = await post(route.handler, { kind: 'skill', name: 'find-skills', enabled: true });

    expect(status).toBe(200);
    expect(rec.skillDisposed).toBe(0);
  });
});

describe('switching a system tool', () => {
  it('masks the tool through the scoped registry', async () => {
    const { route, rec } = bootHost();
    const { status } = await post(route.handler, { kind: 'system-tool', name: 'bash', enabled: false });

    expect(status).toBe(200);
    expect(rec.restrictCalls.some((call) => call.deny.includes('bash'))).toBe(true);
  });

  it('reports the tool as disabled in the catalog', async () => {
    const { route } = bootHost();
    await post(route.handler, { kind: 'system-tool', name: 'bash', enabled: false });
    const catalog = await readCatalog(route.handler);

    expect(catalog.systemTools.find((t) => t.name === 'bash')?.enabled).toBe(false);
  });

  it('refuses to mask run_code, the reserved transport', async () => {
    const { route } = bootHost();
    const { status, body } = await post(route.handler, { kind: 'system-tool', name: 'run_code', enabled: false });

    expect(status).toBe(409);
    expect(errorOf(body)).toMatch(/run_code/);
  });

  it('marks run_code reserved in the catalog so no switch is offered', async () => {
    const { route } = bootHost();
    const catalog = await readCatalog(route.handler);

    expect(catalog.systemTools.find((t) => t.name === 'run_code')?.reserved).toBe(true);
  });

  it('releases the mask when re-enabled', async () => {
    const { route, rec } = bootHost();
    await post(route.handler, { kind: 'system-tool', name: 'bash', enabled: false });
    await post(route.handler, { kind: 'system-tool', name: 'bash', enabled: true });

    expect(rec.restrictDisposed).toBeGreaterThan(0);
  });
});

describe('switching MCP', () => {
  it('masks one MCP tool by its full wire name', async () => {
    const { route, rec } = bootHost();
    const { status } = await post(route.handler, {
      kind: 'mcp-tool',
      name: 'mcp__doubao-search__web_search',
      enabled: false,
    });

    expect(status).toBe(200);
    expect(rec.restrictCalls.some((call) => call.deny.includes('mcp__doubao-search__web_search'))).toBe(true);
  });

  it('masks every tool of a server when the server is switched off', async () => {
    const { route, rec } = bootHost();
    const { status } = await post(route.handler, { kind: 'mcp-server', name: 'doubao-search', enabled: false });

    expect(status).toBe(200);
    const denied = rec.restrictCalls.flatMap((call) => [...call.deny]);
    expect(denied).toContain('mcp__doubao-search__web_search');
    expect(denied).toContain('mcp__doubao-search__image_search');
  });

  it('reports the whole server as disabled in the catalog', async () => {
    const { route } = bootHost();
    await post(route.handler, { kind: 'mcp-server', name: 'doubao-search', enabled: false });
    const catalog = await readCatalog(route.handler);

    const server = catalog.mcp.find((s) => s.server === 'doubao-search');
    expect(server?.enabled).toBe(false);
    expect(server?.tools.every((tool) => !tool.enabled)).toBe(true);
  });

  it('rejects a server that exposes no tools', async () => {
    const { route } = bootHost();
    const { status, body } = await post(route.handler, { kind: 'mcp-server', name: 'ghost', enabled: false });

    expect(status).toBe(404);
    expect(errorOf(body)).toMatch(/exposes no tools/);
  });

  it('releases a server mask when re-enabled', async () => {
    const { route, rec } = bootHost();
    await post(route.handler, { kind: 'mcp-server', name: 'doubao-search', enabled: false });
    await post(route.handler, { kind: 'mcp-server', name: 'doubao-search', enabled: true });

    expect(rec.restrictDisposed).toBeGreaterThan(0);
  });
});

describe('when the session has no usable agent', () => {
  it('reports the real cause rather than a bare status', async () => {
    const { route } = bootHost({ agents: { get: () => undefined } });
    const { status, body } = await post(route.handler, { kind: 'skill', name: 'find-skills', enabled: false });

    expect(status).toBe(404);
    expect(errorOf(body)).toMatch(/session agent is not available/);
  });

  it('reports missing scoped capability registries as unavailable', async () => {
    const { route } = bootHost({
      agents: { get: () => ({ id: 'a', ctx: { get: () => undefined }, session: {
            header: {},
            snapshotEvents: () => [],
            surface: { nodes: [] },
          } }) },
    });
    const tool = await post(route.handler, { kind: 'system-tool', name: 'bash', enabled: false });
    expect(tool.status).toBe(503);
    expect(errorOf(tool.body)).toMatch(/session tools service is not available/);

    const skill = await post(route.handler, { kind: 'skill', name: 'find-skills', enabled: false });
    expect(skill.status).toBe(503);
    expect(errorOf(skill.body)).toMatch(/session skills service is not available/);
  });

  it('reports a missing scoped skills registry separately', async () => {
    const { route } = bootHost({
      agents: { get: () => ({ id: 'a', ctx: { get: () => undefined }, session: {
            header: {},
            snapshotEvents: () => [],
            surface: { nodes: [] },
          } }) },
    });
    const { status, body } = await post(route.handler, { kind: 'skill', name: 'find-skills', enabled: false });

    expect(status).toBe(503);
    expect(errorOf(body)).toMatch(/session skills service is not available/);
  });
});

describe('idempotence and remaining service failures', () => {
  it('disabling an MCP tool twice masks it once', async () => {
    const { route, rec } = bootHost();
    await post(route.handler, { kind: 'mcp-tool', name: 'mcp__doubao-search__web_search', enabled: false });
    const afterFirst = rec.restrictCalls.length;
    await post(route.handler, { kind: 'mcp-tool', name: 'mcp__doubao-search__web_search', enabled: false });

    expect(rec.restrictCalls).toHaveLength(afterFirst);
  });

  it('disabling an MCP server twice masks it once', async () => {
    const { route, rec } = bootHost();
    await post(route.handler, { kind: 'mcp-server', name: 'doubao-search', enabled: false });
    const afterFirst = rec.restrictCalls.length;
    await post(route.handler, { kind: 'mcp-server', name: 'doubao-search', enabled: false });

    expect(rec.restrictCalls).toHaveLength(afterFirst);
  });

  it('re-enabling an MCP tool that was never masked is a no-op', async () => {
    const { route, rec } = bootHost();
    const { status } = await post(route.handler, {
      kind: 'mcp-tool',
      name: 'mcp__doubao-search__web_search',
      enabled: true,
    });

    expect(status).toBe(200);
    expect(rec.restrictDisposed).toBe(0);
  });

  it('rejects unknown MCP and system tools without creating ghost masks', async () => {
    const { route, rec } = bootHost();
    for (const kind of ['mcp-tool', 'system-tool'] as const) {
      const { status, body } = await post(route.handler, { kind, name: kind === 'mcp-tool' ? 'mcp__ghost__missing' : 'ghost', enabled: false });
      expect(status).toBe(404);
      expect(errorOf(body)).toMatch(/not available in this session/);
    }
    expect(rec.restrictCalls).toHaveLength(0);
  });

  it('refuses a skill toggle when the skills service is absent', async () => {
    const { route } = bootHost({ skills: undefined });
    const { status, body } = await post(route.handler, { kind: 'skill', name: 'find-skills', enabled: false });

    expect(status).toBe(503);
    expect(errorOf(body)).toMatch(/skills service unavailable/);
  });

  it('refuses to shadow a skill this session cannot see', async () => {
    // Shadowing an unknown name would register a phantom entry the panel
    // could never explain.
    const { route } = bootHost({
      skills: {
        list: () => Promise.resolve([{ name: 'find-skills' }]),
        get: () => Promise.resolve(undefined),
      },
    });
    const { status, body } = await post(route.handler, { kind: 'skill', name: 'ghost', enabled: false });

    expect(status).toBe(404);
    expect(errorOf(body)).toMatch(/not available in this session/);
  });

  it('reports a missing agent for an MCP tool toggle', async () => {
    const { route } = bootHost({ agents: { get: () => undefined } });
    const { status, body } = await post(route.handler, {
      kind: 'mcp-tool',
      name: 'mcp__doubao-search__web_search',
      enabled: false,
    });

    expect(status).toBe(404);
    expect(errorOf(body)).toMatch(/session agent is not available/);
  });

  it('reports a missing agent for an MCP server toggle', async () => {
    const { route } = bootHost({ agents: { get: () => undefined } });
    const { status, body } = await post(route.handler, { kind: 'mcp-server', name: 'doubao-search', enabled: false });

    expect(status).toBe(404);
    expect(errorOf(body)).toMatch(/session agent is not available/);
  });
});

describe('a preset-level tool, absent from the global registry', () => {
  it('is masked through state alone, without a registry restrict', async () => {
    // Only global names can be restricted at the registry; a preset-layer tool
    // is masked by the waterfall and the guard reading the live map instead.
    const { route, rec } = bootHost();
    const { status } = await post(route.handler, { kind: 'system-tool', name: 'preset_only', enabled: false });

    expect(status).toBe(200);
    expect(rec.restrictCalls).toHaveLength(0);
  });

  it('is idempotent, and re-enabling clears it', async () => {
    const { route } = bootHost();
    await post(route.handler, { kind: 'system-tool', name: 'preset_only', enabled: false });
    await post(route.handler, { kind: 'system-tool', name: 'preset_only', enabled: false });
    const { status } = await post(route.handler, { kind: 'system-tool', name: 'preset_only', enabled: true });

    expect(status).toBe(200);
  });
});

describe('releasing masks after dependencies disappear', () => {
  it('releases skill, server, MCP-tool and system-tool masks from owned state', async () => {
    const { route, rec, ctx } = bootHost();
    await post(route.handler, { kind: 'skill', name: 'find-skills', enabled: false });
    await post(route.handler, { kind: 'mcp-server', name: 'doubao-search', enabled: false });
    await post(route.handler, { kind: 'mcp-tool', name: 'mcp__doubao-search__web_search', enabled: false });
    await post(route.handler, { kind: 'system-tool', name: 'bash', enabled: false });
    const disposedBefore = rec.restrictDisposed;

    delete ctx['agents'];
    delete ctx['tools'];
    for (const toggle of [
      { kind: 'skill', name: 'find-skills' },
      { kind: 'mcp-server', name: 'doubao-search' },
      { kind: 'mcp-tool', name: 'mcp__doubao-search__web_search' },
      { kind: 'system-tool', name: 'bash' },
    ] as const) {
      const result = await post(route.handler, { ...toggle, enabled: true });
      expect(result.status).toBe(200);
    }

    expect(rec.skillDisposed).toBe(1);
    expect(rec.restrictDisposed).toBeGreaterThan(disposedBefore);
  });
});

describe('capability paths with partial hosts', () => {
  it('disables a skill for an agent whose session carries no cwd', async () => {
    const { route, rec } = bootHost({
      agents: {
        get: () => ({
          id: 'agent-1',
          ctx: {
            get: (name: string) =>
              name === 'skills' ? { register: (entry: { name: string }) => { rec.registeredSkills.push(entry); return () => {}; } } : undefined,
          },
          session: {
            header: {},
            snapshotEvents: () => [],
            surface: { nodes: [] },
          },
        }),
      },
    });
    const { status } = await post(route.handler, { kind: 'skill', name: 'find-skills', enabled: false });

    expect(status).toBe(200);
    expect(rec.registeredSkills[0]?.name).toBe('find-skills');
  });

  it('carries resourceBase through to the shadow when the original has one', async () => {
    const resourceBase = { path: '/skills/find-skills' };
    const { route, rec } = bootHost({
      skills: {
        list: () => Promise.resolve([{ name: 'find-skills', description: 'd' }]),
        get: (name: string) => Promise.resolve({ name, description: 'd', content: 'c', resourceBase }),
      },
    });
    const { status } = await post(route.handler, { kind: 'skill', name: 'find-skills', enabled: false });

    expect(status).toBe(200);
    expect((rec.registeredSkills[0] as { resourceBase?: unknown } | undefined)?.resourceBase).toEqual(resourceBase);
  });

  it('cannot expand a server mask while the global tools service is absent', async () => {
    // The scoped registry may exist on the agent even when the host-level
    // tools service is gone; without the global view there is no honest list
    // of the server's tools, so the toggle refuses rather than masks nothing.
    const { route } = bootHost({ tools: undefined });
    const { status, body } = await post(route.handler, { kind: 'mcp-server', name: 'doubao-search', enabled: false });

    expect(status).toBe(503);
    expect(errorOf(body)).toMatch(/tools service unavailable/);
  });

  it('refuses a system-tool mask when no catalog can prove the name exists', async () => {
    const { route, rec } = bootHost({ tools: undefined });
    const { status, body } = await post(route.handler, { kind: 'system-tool', name: 'bash', enabled: false });

    expect(status).toBe(503);
    expect(errorOf(body)).toMatch(/tools service unavailable/);
    expect(rec.restrictCalls).toHaveLength(0);
  });
});
