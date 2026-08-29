/**
 * The edges that only appear when input is hostile or a service answers in a
 * shape this plugin did not expect. Each one has a deliberate verdict in the
 * source — reject, degrade, or ignore — and this file pins those verdicts so a
 * refactor cannot quietly turn one into a silent success.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
async function postRaw(handler: Handler, raw: string, streamable = true): Promise<{ status: number; body: string }> {
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
    req['on'] = (event: string, listener: (chunk?: unknown) => void) => {
      if (event === 'data') onData = listener;
      if (event === 'end') {
        onData?.(raw);
        listener();
      }
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
    const { status } = await postRaw(route.handler, oversize);

    expect(status).toBe(500);
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
