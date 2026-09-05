/**
 * The edges that only appear when input is hostile or a service answers in a
 * shape this plugin did not expect. Each one has a deliberate verdict in the
 * source — reject, degrade, or ignore — and this file pins those verdicts so a
 * refactor cannot quietly turn one into a silent success.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { env } from 'node:process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { apply } from '../../src/index.js';

type Handler = (req: unknown, res: unknown) => Promise<void> | void;

function bootHost(overrides: Record<string, unknown> = {}) {
  const routes: { path: string; handler: Handler }[] = [];
  const effects: (() => (() => void) | void)[] = [];

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
        ctx: { get: (name: string) => (name === 'tools' ? { restrict: () => () => {} } : undefined) },
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
      schemas: () => [{ name: 'bash', description: 'run a shell command' }],
      guard: () => () => {},
    },
    on: () => {},
    effect(factory: () => (() => void) | void) {
      effects.push(factory);
    },
  };

  const merged: Record<string, unknown> = { ...base, ...overrides };
  const ctx: Record<string, unknown> = Object.fromEntries(
    Object.entries(merged).filter(([, value]) => value !== undefined),
  );
  ctx['get'] = (name: string) => ctx[name];

  apply(ctx as never);
  for (const factory of effects) factory();

  const route = routes[0];
  if (route === undefined) throw new Error('route was never registered');
  return route;
}

async function requestText(
  handler: Handler,
  method: string,
  url: string,
  extraHeaders: Record<string, string> = {},
  payload?: string,
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  let status = 0;
  let body = '';
  let headers: Record<string, string> = {};
  const req = {
    method,
    url,
    headers: { host: '127.0.0.1:3080', ...extraHeaders },
    socket: { remoteAddress: '127.0.0.1' },
    // The route reads a POST body through the stream events, so a request
    // carrying one has to replay them.
    on(event: string, handle: (chunk?: unknown) => void) {
      if (payload !== undefined && event === 'data') handle(Buffer.from(payload));
      if (event === 'end') handle();
      return req;
    },
  };
  await handler(req, {
    writeHead(code: number, values: Record<string, string>) { status = code; headers = values; },
    end(chunk?: string) { body = chunk ?? ''; },
  });
  return { status, body, headers };
}

async function getJson(handler: Handler, url: string): Promise<{ status: number; parsed: unknown }> {
  let status = 0;
  let body = '';
  const req = {
    method: 'GET',
    url,
    headers: { host: '127.0.0.1:3080' },
    socket: { remoteAddress: '127.0.0.1' },
    on: () => req,
  };
  await handler(req, { writeHead(code: number) { status = code; }, end(chunk?: string) { body = chunk ?? ''; } });
  return { status, parsed: body === '' ? null : JSON.parse(body) };
}

/** POST with an explicit raw body, so oversize and unparseable cases are reachable. */
async function postRaw(
  handler: Handler,
  raw: string | string[],
  streamable = true,
  streamError?: unknown,
): Promise<{ status: number; body: string }> {
  let status = 0;
  let out = '';
  const req: Record<string, unknown> = {
    method: 'POST',
    url: '/api/agent-toolkit?session=s1',
    headers: { host: '127.0.0.1:3080', 'content-type': 'application/json' },
    socket: { remoteAddress: '127.0.0.1' },
  };
  if (streamable) {
    let onData: ((chunk: unknown) => void) | undefined;
    let onEnd: (() => void) | undefined;
    let onError: ((error: unknown) => void) | undefined;
    req['on'] = (event: string, listener: (chunk?: unknown) => void) => {
      if (event === 'data') onData = listener;
      if (event === 'end') onEnd = listener;
      if (event === 'error') onError = listener;
      // Emit on a microtask: a real stream fires after every listener is
      // attached, not synchronously inside the second on() call.
      queueMicrotask(() => {
        for (const chunk of Array.isArray(raw) ? raw : [raw]) onData?.(chunk);
        if (streamError !== undefined) onError?.(streamError);
        else onEnd?.();
      });
      return req;
    };
  }
  await handler(req, { writeHead(code: number) { status = code; }, end(chunk?: string) { out = chunk ?? ''; } });
  return { status, body: out };
}

// Every one of these responses reflects live process state, and an error is
// the most volatile of them: a 503 from a service that had not come up yet
// must not be what the browser keeps showing after it has.
describe('cache headers', () => {
  it('marks catalog responses no-store', async () => {
    const route = bootHost();
    const result = await requestText(route.handler, 'GET', '/api/agent-toolkit?session=s1');

    expect(result.status).toBe(200);
    expect(result.headers['cache-control']).toBe('no-store');
  });

  it('marks error responses no-store too', async () => {
    // A malformed toggle body: rejected by validation, so the response is
    // produced by the error branch rather than the success one.
    const route = bootHost();
    const result = await requestText(route.handler, 'POST', '/api/agent-toolkit?session=s1', {
      'content-type': 'application/json',
    }, '{"kind":"nonsense"}');

    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.headers['cache-control'], 'a transient failure must not be cacheable').toBe('no-store');
  });
});

// The route owns one prefix and three paths under it. Anything else is a
// caller mistake, and answering it with the catalogue hides typos and makes
// every future sub-path a silent behaviour change.
describe('unknown sub-paths', () => {
  it.each(['/api/agent-toolkit/bogus', '/api/agent-toolkit/presets/extra', '/api/agent-toolkit/stats/x'])(
    'answers 404 for %s',
    async (path) => {
      const route = bootHost();
      const result = await requestText(route.handler, 'GET', path);

      expect(result.status).toBe(404);
    },
  );

  // The point is that each real path is still ROUTED -- not 404 -- whatever
  // its handler then answers. This fixture has no agent-presets service, so
  // /presets legitimately reports 503.
  it('still routes the three real paths', async () => {
    const route = bootHost();
    for (const path of ['/api/agent-toolkit?session=s1', '/api/agent-toolkit/presets', '/api/agent-toolkit/stats']) {
      expect((await requestText(route.handler, 'GET', path)).status, path).not.toBe(404);
    }
  });
});

describe('HTTP method boundaries', () => {
  it('allows only GET on the stats endpoint', async () => {
    const route = bootHost();
    const result = await requestText(route.handler, 'POST', '/api/agent-toolkit/stats');

    expect(result.status).toBe(405);
    expect(result.headers['allow']).toBe('GET');
  });

  it('allows only GET and POST on the catalog endpoint', async () => {
    const route = bootHost();
    const result = await requestText(route.handler, 'DELETE', '/api/agent-toolkit');

    expect(result.status).toBe(405);
    expect(result.headers['allow']).toBe('GET, POST');
  });
});

describe('request body limits', () => {
  it('refuses a body past the size cap rather than buffering it', async () => {
    const route = bootHost();
    const oversize = JSON.stringify({ kind: 'skill', name: 'x'.repeat(20_000), enabled: false });
    const { status, body } = await postRaw(route.handler, oversize);

    expect(status).toBe(413);
    expect(body).toMatch(/too large/);
  });

  it('stops reading once the cap has fired, even if more chunks arrive', async () => {
    // A chunked upload that crosses the cap mid-stream: the rejection must
    // stick, later chunks must not accumulate, and `end` must not resolve
    // over the rejection.
    const route = bootHost();
    const half = 'x'.repeat(12_000);
    const { status, body } = await postRaw(route.handler, [half, half, half]);

    expect(status).toBe(413);
    expect(body).toMatch(/too large/);
  });

  it('surfaces a stream error as a 500, not a hang', async () => {
    const route = bootHost();
    const { status, body } = await postRaw(route.handler, '{}', true, new Error('socket reset'));

    expect(status).toBe(500);
    expect(body).toMatch(/socket reset/);
  });

  it('refuses when the request exposes no readable stream', async () => {
    const route = bootHost();
    const { status, body } = await postRaw(route.handler, '{}', false);

    expect(status).toBe(400);
    expect(body).toMatch(/stream unavailable/);
  });

  it('treats an empty body as an empty object, then fails validation', async () => {
    const route = bootHost();
    const { status, body } = await postRaw(route.handler, '');

    expect(status).toBe(400);
    expect(body).toMatch(/kind must be/);
  });
});

describe('the stats endpoint', () => {
  it('answers with the log path and counts even when no log exists yet', async () => {
    // The stats log is append-only and shared per DSH_HOME: other tests in
    // this file (and a real ~/.dsh) may already have written to it, so "no
    // log exists" needs its own empty home to be a meaningful assertion.
    const home = mkdtempSync(join(tmpdir(), 'dsh-agent-toolkit-stats-'));
    const previous = env['DSH_HOME'];
    env['DSH_HOME'] = home;
    try {
      const route = bootHost();
      const { status, parsed } = await getJson(route.handler, '/api/agent-toolkit/stats');

      expect(status).toBe(200);
      const payload = parsed as { logFile: string; blocked: Record<string, number>; records: unknown[] };
      expect(payload.logFile).toMatch(/stats\.jsonl$/);
      expect(payload.records).toEqual([]);
      expect(payload.blocked).toEqual({});
    } finally {
      if (previous === undefined) delete env['DSH_HOME'];
      else env['DSH_HOME'] = previous;
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('unexpected service shapes are degraded, never guessed', () => {
  it('degrades when the surface view is not an array of seqs', async () => {
    const route = bootHost({
      agents: {
        get: () => ({
          id: 'agent-1',
          ctx: { get: () => undefined },
          session: {
            header: { cwd: '/tmp/session' },
            snapshotEvents: () => [],
            // Reading this as "empty surface" would silently mislabel every
            // loaded skill as evicted.
            surface: { nodes: { not: 'an array' } },
          },
        }),
      },
    });
    const { parsed } = await getJson(route.handler, '/api/agent-toolkit?session=s1');

    const payload = parsed as { degraded?: string[] };
    expect(payload.degraded?.some((note) => note.includes('live session view unavailable'))).toBe(true);
  });

  it('skips non-numeric surface nodes but keeps the usable ones', async () => {
    const route = bootHost({
      agents: {
        get: () => ({
          id: 'agent-1',
          ctx: { get: () => undefined },
          session: {
            header: { cwd: '/tmp/session' },
            snapshotEvents: () => [],
            surface: { nodes: [null, 'junk', 7] },
          },
        }),
      },
    });
    const { status, parsed } = await getJson(route.handler, '/api/agent-toolkit?session=s1');

    expect(status).toBe(200);
    const payload = parsed as { degraded?: string[] };
    expect(payload.degraded?.some((note) => note.includes('live session view unavailable'))).not.toBe(true);
  });

  it('reports a tools service that throws', async () => {
    const route = bootHost({
      tools: {
        schemas: () => {
          throw new Error('registry exploded');
        },
        guard: () => () => {},
      },
    });
    const { status, parsed } = await getJson(route.handler, '/api/agent-toolkit?session=s1');

    expect(status).toBe(200);
    const payload = parsed as { degraded?: string[]; systemTools: unknown[] };
    expect(payload.systemTools).toEqual([]);
    expect(payload.degraded?.some((note) => note.includes('registry exploded'))).toBe(true);
  });

  it('skips a tool schema whose name is not a string', async () => {
    const route = bootHost({
      tools: {
        schemas: () => [{ name: 42 }, { name: 'bash', description: 'ok' }],
        guard: () => () => {},
      },
    });
    const { parsed } = await getJson(route.handler, '/api/agent-toolkit?session=s1');

    const payload = parsed as { systemTools: { name: string }[] };
    expect(payload.systemTools.map((tool) => tool.name)).toEqual(['bash']);
  });
});

describe('non-loopback callers', () => {
  it('are refused before any session data is read', async () => {
    const route = bootHost();
    let status = 0;
    const req = {
      method: 'GET',
      url: '/api/agent-toolkit?session=s1',
      headers: { host: '127.0.0.1:3080' },
      socket: { remoteAddress: '203.0.113.9' },
      on: () => req,
    };
    await route.handler(req, { writeHead(code: number) { status = code; }, end() {} });

    expect(status).toBe(403);
  });
});

describe('a request with no session', () => {
  it('serves the catalog with no session-specific state', async () => {
    // The panel opens before a session is chosen; it must still render, and
    // an arbitrary ?session= must never mint a state entry.
    const route = bootHost();
    const { status, parsed } = await getJson(route.handler, '/api/agent-toolkit');

    expect(status).toBe(200);
    const payload = parsed as { sessionId: null; skills: unknown[]; systemTools: unknown[] };
    expect(payload.sessionId).toBeNull();
    expect(payload.skills).toEqual([]);
    expect(payload.systemTools.length).toBeGreaterThan(0);
  });
});

describe('server masks expand over the global tool view', () => {
  it('counts a denial of a tool masked only through its server', async () => {
    // The scoped view of a restricted agent no longer lists these names, so
    // the expansion has to read the global view or the denial goes uncounted.
    const schemas = [
      { name: 'bash', description: 'shell' },
      { name: 'mcp__doubao-search__web_search', description: 'search' },
      { name: 42 },
    ];
    let onResult: ((execution: unknown, result: unknown) => void) | undefined;
    const routes: { path: string; handler: Handler }[] = [];
    const effects: (() => (() => void) | void)[] = [];
    const ctx = {
      webServer: { register(spec: { path: string; handler: Handler }) { routes.push(spec); return () => {}; } },
      agents: {
        get: () => ({
          id: 'agent-1',
          ctx: { get: (name: string) => (name === 'tools' ? { restrict: () => () => {} } : undefined) },
          session: {
            header: { cwd: '/tmp' },
            snapshotEvents: () => [],
            surface: { nodes: [] },
          },
        }),
      },
      skills: { list: () => Promise.resolve([]), get: () => Promise.resolve(undefined) },
      tools: { schemas: () => schemas, guard: () => () => {} },
      on(event: string, listener: unknown) {
        if (event === 'tools/result') onResult = listener as (execution: unknown, result: unknown) => void;
      },
      effect(factory: () => (() => void) | void) { effects.push(factory); },
      get(name: string) {
        return (this as unknown as Record<string, unknown>)[name];
      },
    };
    apply(ctx as never);
    for (const factory of effects) factory();
    const route = routes[0];
    if (route === undefined) throw new Error('route was never registered');

    await postRaw(route.handler, JSON.stringify({ kind: 'mcp-server', name: 'doubao-search', enabled: false }));
    onResult?.(
      { agent: { id: 's1' }, name: 'mcp__doubao-search__web_search' },
      { isError: true, error: { info: { code: 'UNKNOWN_TOOL' }, message: 'unknown tool' } },
    );

    const { parsed } = await getJson(route.handler, '/api/agent-toolkit/stats');
    const payload = parsed as { blocked: Record<string, number> };
    expect(payload.blocked['mcp__doubao-search__web_search']).toBe(1);
  });
});

describe('the stats endpoint reads a real log', () => {
  it('returns the recorded lines and ignores blank or corrupt ones', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-agent-toolkit-stats-'));
    const previous = env['DSH_HOME'];
    env['DSH_HOME'] = home;
    try {
      mkdirSync(join(home, 'agent-toolkit'), { recursive: true });
      writeFileSync(
        join(home, 'agent-toolkit', 'stats.jsonl'),
        [
          JSON.stringify({ ts: '2025-01-01T00:00:00.000Z', sessionId: 's1', kind: 'blocked-tool', name: 'bash' }),
          '',
          '   ',
          JSON.stringify({ ts: '2025-01-01T00:01:00.000Z', sessionId: 's1', kind: 'blocked-skill', name: 'find' }),
        ].join('\n'),
        'utf8',
      );

      const route = bootHost();
      const { status, parsed } = await getJson(route.handler, '/api/agent-toolkit/stats');

      expect(status).toBe(200);
      const payload = parsed as { records: { name: string }[] };
      expect(payload.records.map((record) => record.name)).toEqual(['bash', 'find']);
    } finally {
      if (previous === undefined) delete env['DSH_HOME'];
      else env['DSH_HOME'] = previous;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('answers rather than failing when the log holds a corrupt line', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-agent-toolkit-stats-'));
    const previous = env['DSH_HOME'];
    env['DSH_HOME'] = home;
    try {
      mkdirSync(join(home, 'agent-toolkit'), { recursive: true });
      writeFileSync(join(home, 'agent-toolkit', 'stats.jsonl'), '{not json\n', 'utf8');

      const route = bootHost();
      const { status, parsed } = await getJson(route.handler, '/api/agent-toolkit/stats');

      // A truncated tail is normal for an append-only log; the endpoint must
      // still answer instead of turning a diagnostic into an outage.
      expect(status).toBe(200);
      const payload = parsed as { records: unknown[]; warnings?: string[] };
      expect(payload.records).toEqual([]);
      expect(payload.warnings?.[0]).toMatch(/line 1 skipped/);
    } finally {
      if (previous === undefined) delete env['DSH_HOME'];
      else env['DSH_HOME'] = previous;
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('reading the live session view', () => {
  const skillCall = (seq: number, name: string, callId: string) => ({
    type: 'tool/call',
    seq,
    data: { name: 'skill', arguments: JSON.stringify({ name }), callId },
  });
  const skillResult = (seq: number, callId: string, text = 'skill instructions') => ({
    type: 'tool/result',
    seq,
    data: { message: { source: { callId }, content: [{ content: [{ type: 'text', text }] }] } },
  });
  // The method reads `this.seq` in a default parameter exactly like the real
  // Session, so a host that detaches the method (const f = s.snapshotEvents)
  // fails here instead of silently passing with an arrow-function fake.
  const liveSession = (events: unknown[], nodes: unknown[]) => ({
    header: { cwd: '/tmp/session' },
    seq: 0,
    surface: { nodes },
    snapshotEvents(this: { seq: number }, _fromSeq = 0, _toSeqExclusive: number = this.seq) {
      return events;
    },
  });
  const agentWith = (events: unknown[], nodes: unknown[]) => ({
    agents: {
      get: () => ({
        id: 'agent-1',
        ctx: { get: () => undefined },
        session: liveSession(events, nodes),
      }),
    },
  });

  it('classifies loaded, pruned, and evicted skills from the surface', async () => {
    const events = [
      skillCall(1, 'find-skills', 'c1'),
      skillResult(2, 'c1'),
      skillCall(3, 'lark-im', 'c2'),
      skillResult(4, 'c2', 'head\n\n[... tool result middle pruned ...]\n\ntail'),
    ];
    // c2's stub is on the surface (pruned); c1's result was compacted away.
    const route = bootHost({
      ...agentWith(events, [4]),
      skills: {
        list: () => Promise.resolve([{ name: 'find-skills', description: 'd' }, { name: 'lark-im', description: 'd' }]),
        get: (name: string) => Promise.resolve({ name, description: 'd', content: 'c' }),
      },
    });
    const { parsed } = await getJson(route.handler, '/api/agent-toolkit?session=s1');

    const payload = parsed as { skills: { name: string; state: string }[] };
    expect(payload.skills.find((s) => s.name === 'find-skills')?.state).toBe('evicted');
    expect(payload.skills.find((s) => s.name === 'lark-im')?.state).toBe('pruned');
  });

  it('reads loaded when the paired result is on the surface intact', async () => {
    const events = [skillCall(1, 'find-skills', 'c1'), skillResult(2, 'c1')];
    const route = bootHost(agentWith(events, [2]));
    const { parsed } = await getJson(route.handler, '/api/agent-toolkit?session=s1');

    const payload = parsed as { skills: { name: string; state: string }[] };
    expect(payload.skills.find((s) => s.name === 'find-skills')?.state).toBe('loaded');
  });

  it('stringifies a non-Error thrown by the live log read', async () => {
    const route = bootHost({
      agents: {
        get: () => ({
          id: 'agent-1',
          ctx: { get: () => undefined },
          session: {
            header: { cwd: '/tmp/session' },
            snapshotEvents: () => {
              throw 'log vanished';
            },
            surface: { nodes: [] },
          },
        }),
      },
    });
    const { parsed } = await getJson(route.handler, '/api/agent-toolkit?session=s1');

    expect((parsed as { degraded?: string[] }).degraded?.some((n) => n.includes('log vanished'))).toBe(true);
  });
});

describe('tool descriptions', () => {
  it('omits an empty description rather than shipping a blank field', async () => {
    const route = bootHost({
      tools: {
        schemas: () => [
          { name: 'bash', description: '' },
          { name: 'read', description: 'read a file' },
        ],
        guard: () => () => {},
      },
    });
    const { parsed } = await getJson(route.handler, '/api/agent-toolkit?session=s1');

    const payload = parsed as { systemTools: { name: string; description?: string }[] };
    expect(payload.systemTools.find((t) => t.name === 'bash')).not.toHaveProperty('description');
    expect(payload.systemTools.find((t) => t.name === 'read')?.description).toBe('read a file');
  });
});

describe('boundary shape variants', () => {
  it('keeps a skill whose description is not a string, without the field', async () => {
    const route = bootHost({
      skills: {
        list: () => Promise.resolve([{ name: 'find-skills', description: 42 }]),
        get: (name: string) => Promise.resolve({ name, description: 'd', content: 'c' }),
      },
    });
    const { parsed } = await getJson(route.handler, '/api/agent-toolkit?session=s1');

    const payload = parsed as { skills: { name: string; description?: string }[] };
    const skill = payload.skills.find((s) => s.name === 'find-skills');
    expect(skill).toBeDefined();
    expect(skill).not.toHaveProperty('description');
  });

  it('reports a tools service that throws a non-Error', async () => {
    const route = bootHost({
      tools: {
        schemas: () => {
          throw 'registry exploded';
        },
        guard: () => () => {},
      },
    });
    const { status, parsed } = await getJson(route.handler, '/api/agent-toolkit?session=s1');

    expect(status).toBe(200);
    const payload = parsed as { degraded?: string[] };
    expect(payload.degraded?.some((note) => note.includes('registry exploded'))).toBe(true);
  });

  it('carries degraded notes on the no-session payload too', async () => {
    const route = bootHost({
      tools: {
        schemas: () => {
          throw new Error('registry exploded');
        },
        guard: () => () => {},
      },
    });
    const { status, parsed } = await getJson(route.handler, '/api/agent-toolkit');

    expect(status).toBe(200);
    const payload = parsed as { sessionId: null; degraded?: string[] };
    expect(payload.sessionId).toBeNull();
    expect(payload.degraded?.some((note) => note.includes('registry exploded'))).toBe(true);
  });

  it('answers a request whose url is absent, as the catalog root', async () => {
    const route = bootHost();
    let status = 0;
    let body = '';
    const req = {
      method: 'GET',
      headers: { host: '127.0.0.1:3080' },
      socket: { remoteAddress: '127.0.0.1' },
      on: () => req,
    };
    await route.handler(req, { writeHead(code: number) { status = code; }, end(chunk?: string) { body = chunk ?? ''; } });

    expect(status).toBe(200);
    expect((JSON.parse(body) as { sessionId: null }).sessionId).toBeNull();
  });

  it('wraps a non-Error stream failure in an Error', async () => {
    const route = bootHost();
    const { status, body } = await postRaw(route.handler, '{}', true, 'socket reset');

    expect(status).toBe(500);
    expect(body).toMatch(/socket reset/);
  });

  it('stringifies a non-Error thrown out of a service call', async () => {
    const route = bootHost({
      agents: {
        get: () => {
          throw 'agent registry gone';
        },
      },
    });
    const { status, parsed } = await getJson(route.handler, '/api/agent-toolkit?session=s1');

    expect(status).toBe(500);
    expect((parsed as { error: string }).error).toMatch(/agent registry gone/);
  });
});

describe('stats file location', () => {
  it('falls back to ~/.dsh when DSH_HOME is unset', async () => {
    const previous = env['DSH_HOME'];
    delete env['DSH_HOME'];
    try {
      const route = bootHost();
      const { parsed } = await getJson(route.handler, '/api/agent-toolkit/stats');

      // Not `~/agent-toolkit`: a normal install does not export DSH_HOME into
      // the server process, so this fallback is the common path, not an edge.
      expect((parsed as { logFile: string }).logFile).toBe(join(homedir(), '.dsh', 'agent-toolkit', 'stats.jsonl'));
    } finally {
      if (previous !== undefined) env['DSH_HOME'] = previous;
    }
  });
});

describe('MCP tool descriptions', () => {
  it('omits the field for a tool whose description is empty', async () => {
    const route = bootHost({
      tools: {
        schemas: () => [
          { name: 'mcp__doubao-search__web_search', description: '' },
          { name: 'mcp__doubao-search__image_search', description: 'search images' },
        ],
        guard: () => () => {},
      },
    });
    const { parsed } = await getJson(route.handler, '/api/agent-toolkit?session=s1');

    const payload = parsed as { mcp: { tools: { name: string; description?: string }[] }[] };
    const tools = payload.mcp[0]?.tools ?? [];
    expect(tools.find((t) => t.name === 'mcp__doubao-search__web_search')).not.toHaveProperty('description');
    expect(tools.find((t) => t.name === 'mcp__doubao-search__image_search')?.description).toBe('search images');
  });
});
