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
        session: { header: { cwd: '/tmp/session' } },
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
    sessionQuery: {
      readSession: () => Promise.resolve({ events: [] }),
      listEvents: () => Promise.resolve([]),
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

describe('request body limits', () => {
  it('refuses a body past the size cap rather than buffering it', async () => {
    const route = bootHost();
    const oversize = JSON.stringify({ kind: 'skill', name: 'x'.repeat(20_000), enabled: false });
    const { status, body } = await postRaw(route.handler, oversize);

    expect(status).toBe(500);
    expect(body).toMatch(/too large/);
  });

  it('stops reading once the cap has fired, even if more chunks arrive', async () => {
    // A chunked upload that crosses the cap mid-stream: the rejection must
    // stick, later chunks must not accumulate, and `end` must not resolve
    // over the rejection.
    const route = bootHost();
    const half = 'x'.repeat(12_000);
    const { status, body } = await postRaw(route.handler, [half, half, half]);

    expect(status).toBe(500);
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

    expect(status).toBe(500);
    expect(body).toMatch(/stream unavailable/);
  });

  it('treats an empty body as an empty object, then fails validation', async () => {
    const route = bootHost();
    const { status, body } = await postRaw(route.handler, '');

    expect(status).toBe(500);
    expect(body).toMatch(/kind must be/);
  });
});

describe('the stats endpoint', () => {
  it('answers with the log path and counts even when no log exists yet', async () => {
    const route = bootHost();
    const { status, parsed } = await getJson(route.handler, '/api/agent-toolkit/stats');

    expect(status).toBe(200);
    const payload = parsed as { logFile: string; blocked: Record<string, number>; records: unknown[] };
    expect(payload.logFile).toMatch(/stats\.jsonl$/);
    expect(payload.records).toEqual([]);
    expect(payload.blocked).toEqual({});
  });
});

describe('unexpected service shapes are degraded, never guessed', () => {
  it('rejects surface records that lack seq/surface fields', async () => {
    const route = bootHost({
      sessionQuery: {
        readSession: () => Promise.resolve({ events: [{ seq: 1 }] }),
        // Records present but none usable: reading this as "no verdicts"
        // would silently mislabel every skill's load state.
        listEvents: () => Promise.resolve([{ unrelated: true }, { seq: 'not-a-number', surface: 5 }]),
      },
    });
    const { parsed } = await getJson(route.handler, '/api/agent-toolkit?session=s1');

    const payload = parsed as { degraded?: string[] };
    expect(payload.degraded?.some((note) => note.includes('surface verdicts'))).toBe(true);
  });

  it('skips non-object entries but keeps the usable ones', async () => {
    const route = bootHost({
      sessionQuery: {
        readSession: () => Promise.resolve({ events: [{ seq: 1 }] }),
        listEvents: () => Promise.resolve([null, 'junk', { seq: 1, surface: 'visible' }]),
      },
    });
    const { status, parsed } = await getJson(route.handler, '/api/agent-toolkit?session=s1');

    expect(status).toBe(200);
    const payload = parsed as { degraded?: string[] };
    expect(payload.degraded?.some((note) => note.includes('surface verdicts'))).not.toBe(true);
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
          session: { header: { cwd: '/tmp' } },
        }),
      },
      skills: { list: () => Promise.resolve([]), get: () => Promise.resolve(undefined) },
      tools: { schemas: () => schemas, guard: () => () => {} },
      sessionQuery: { readSession: () => Promise.resolve({ events: [] }), listEvents: () => Promise.resolve([]) },
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
      expect((parsed as { records: unknown[] }).records).toEqual([]);
    } finally {
      if (previous === undefined) delete env['DSH_HOME'];
      else env['DSH_HOME'] = previous;
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('reading a log that is being written', () => {
  it('flags the answer when two reads never agree', async () => {
    // readSession and listEvents are separate calls; a write landing between
    // them yields a mismatched pair. The reader retries once, and if the log
    // is still moving it says so rather than presenting a torn view as fact.
    let seq = 0;
    const route = bootHost({
      sessionQuery: {
        readSession: () => {
          seq += 1;
          return Promise.resolve({ events: [{ seq }] });
        },
        listEvents: () => Promise.resolve([{ seq: 99, surface: 'visible' }]),
      },
    });
    const { parsed } = await getJson(route.handler, '/api/agent-toolkit?session=s1');

    const payload = parsed as { degraded?: string[] };
    expect(payload.degraded?.some((note) => note.includes('log moved while reading'))).toBe(true);
  });

  it('accepts the answer once two reads agree', async () => {
    const route = bootHost({
      sessionQuery: {
        readSession: () => Promise.resolve({ events: [{ seq: 7 }] }),
        listEvents: () => Promise.resolve([{ seq: 7, surface: 'visible' }]),
      },
    });
    const { parsed } = await getJson(route.handler, '/api/agent-toolkit?session=s1');

    const payload = parsed as { degraded?: string[] };
    expect(payload.degraded?.some((note) => note.includes('log moved while reading'))).not.toBe(true);
  });

  it('treats a non-object readSession answer as an unreadable log', async () => {
    const route = bootHost({
      sessionQuery: {
        readSession: () => Promise.resolve(null),
        listEvents: () => Promise.resolve([]),
      },
    });
    const { status, parsed } = await getJson(route.handler, '/api/agent-toolkit?session=s1');

    expect(status).toBe(200);
    expect((parsed as { degraded?: string[] }).degraded?.length).toBeGreaterThan(0);
  });

  it('stringifies a non-Error thrown by the log reader', async () => {
    const route = bootHost({
      sessionQuery: {
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors
        readSession: () => Promise.reject('log vanished'),
        listEvents: () => Promise.resolve([]),
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
          // oxlint-disable-next-line typescript/only-throw-error
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
          // oxlint-disable-next-line typescript/only-throw-error
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
