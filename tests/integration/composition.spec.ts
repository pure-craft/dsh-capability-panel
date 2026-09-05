/**
 * Composition contract: what the host actually mounts, and what the browser
 * actually receives from the route.
 *
 * The HMR suite proves each contribution is removable. This suite proves the
 * contributions are the RIGHT ones: that `cordis.patch.yml` names the module
 * `package.json.main` resolves, that the client half is declared where the
 * bundle loader looks for it, and that a GET through the real route handler
 * answers a payload the client's own parser accepts. A version skew between the
 * two halves is exactly what a unit test of either half alone cannot see.
 */
import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json' with { type: 'json' };
import cordisPatch from '../../cordis.patch.yml?raw';
import { apply } from '../../src/index.js';
import { parsePresetToolPayload } from '../../src/preset-wire.js';
import { parseInspectorPayload } from '../../src/wire.js';

describe('bundle declaration', () => {
  const pkg = packageJson;

  it('points the bundle patch at a file that exists', () => {
    const dsh = pkg['dsh'] as { bundle?: { patch?: string } } | undefined;
    const patchPath = dsh?.bundle?.patch;
    expect(patchPath).toBe('./cordis.patch.yml');
    // The row id the loader inserts must match the package name's tail, so a
    // renamed package cannot silently mount under a stale id.
    expect(cordisPatch).toContain('id: agent-toolkit');
    expect(cordisPatch).toContain("name: 'dsh-agent-toolkit'");
  });

  it('declares the client half where the bundle loader looks for it', () => {
    const dsh = pkg['dsh'] as { client?: { inject?: string[]; platform?: string } } | undefined;
    expect(dsh?.client?.platform).toBe('web');
    // The client half calls ctx.slots, so the renderer that provides the
    // service must be injected or the browser half loads against an absent
    // service.
    expect(dsh?.client?.inject).toContain('@deepseek-ai/dsh-client-ui-renderer');
    expect(dsh?.client?.inject).toContain('@deepseek-ai/dsh-client-ui-layout');
    // The panel's copy registers into the locale runtime, so the locale
    // client plugin must be mounted first or ctx.locale is absent.
    expect(dsh?.client?.inject).toContain('@deepseek-ai/dsh-client-locale');
  });

  it('exports both halves through paths the loader resolves', () => {
    const exports = pkg['exports'] as Record<string, unknown>;
    expect(exports['.']).toMatchObject({ default: './lib/index.js' });
    expect(exports['./client']).toMatchObject({ default: './lib/client.js' });
    // The loader reads the patch through the package's own export map.
    expect(exports['./cordis.patch.yml']).toBe('./cordis.patch.yml');
  });

  it('ships only build output, never source', () => {
    const files = pkg['files'];
    expect(files).toContain('lib');
    expect(files).toContain('cordis.patch.yml');
    expect(files).not.toContain('src');
    expect(files).not.toContain('tests');
  });
});

/**
 * Mirrors the REAL Session's binding requirement: snapshotEvents defaults a
 * parameter from `this.seq` (snapshotEvents(fromSeq = 0, toSeqExclusive =
 * this.seq)), so a detached `const f = session.snapshotEvents; f()` crashes.
 * A plain arrow-function fake would let that regression pass.
 */
class FakeLiveSession {
  readonly header = { cwd: '/tmp/session' };
  readonly surface = { nodes: [] as number[] };
  private readonly seq = 0;

  constructor(private readonly events: unknown[] = []) {}

  snapshotEvents(fromSeq = 0, toSeqExclusive: number = this.seq): readonly unknown[] {
    void fromSeq;
    void toSeqExclusive;
    return this.events;
  }
}

/** A minimal host exposing the services the route needs to answer a GET. */
/**
 * Boot the real `apply()` over a fake host and return its registered route.
 * `overrides` replaces whole service slots, which is how the degradation tests
 * remove a service or make one fail without duplicating this wiring.
 */
export function hostWithCatalog(overrides: Record<string, unknown> = {}) {
  const routes: { path: string; handler: (req: unknown, res: unknown) => Promise<void> | void }[] = [];
  const effects: (() => (() => void) | void)[] = [];

  const base = {
    webServer: {
      register(spec: { path: string; handler: (req: unknown, res: unknown) => Promise<void> | void }) {
        routes.push(spec);
        return () => {};
      },
    },
    agents: {
      get: () => ({
        ctx: { get: () => undefined },
        // The live-session view the catalog reads load states from: borrowed
        // event references plus the current surface seqs.
        session: new FakeLiveSession(),
      }),
    },
    skills: {
      list: () =>
        Promise.resolve([
          { name: 'find-skills', description: 'discover installable skills' },
          { name: 'lark-im', description: 'send and read chat messages' },
        ]),
      get: (name: string) => Promise.resolve({ name, description: 'd', content: 'c' }),
    },
    tools: {
      schemas: () => [
        { name: 'bash', description: 'run a shell command' },
        { name: 'read', description: 'read a file' },
        { name: 'mcp__doubao-search__web_search', description: 'search the web' },
        { name: 'mcp__doubao-search__image_search', description: 'search images' },
      ],
      guard: () => () => {},
    },
    on: () => {},
    effect(factory: () => (() => void) | void) {
      effects.push(factory);
    },
  };

  // `undefined` in an override removes the service, which is how the
  // "service absent" degradations are expressed.
  const merged: Record<string, unknown> = { ...base, ...overrides };
  const ctx: Record<string, unknown> = Object.fromEntries(
    Object.entries(merged).filter(([, value]) => value !== undefined),
  );
  // The plugin reads optional services through ctx.get(name), mirroring the
  // Cordis channel; a deleted key is exactly "service absent".
  ctx['get'] = (name: string) => ctx[name];

  apply(ctx as never);
  for (const factory of effects) factory();

  const route = routes[0];
  if (route === undefined) throw new Error('route was never registered');
  return route;
}

/** GET the route the way a loopback browser request arrives. */
export async function get(
  handler: (req: unknown, res: unknown) => Promise<void> | void,
  url: string,
  remoteAddress = '127.0.0.1',
): Promise<{ status: number; body: string }> {
  let status = 0;
  let body = '';
  const req = {
    method: 'GET',
    url,
    headers: { host: '127.0.0.1:3080' },
    socket: { remoteAddress },
    on: () => req,
  };
  const res = {
    writeHead(code: number) {
      status = code;
    },
    end(chunk?: string) {
      body = chunk ?? '';
    },
  };
  await handler(req, res);
  return { status, body };
}

describe('the route answers a payload the client half accepts', () => {
  it('serves a catalog the client parser validates', async () => {
    const route = hostWithCatalog();
    const { status, body } = await get(route.handler, '/api/agent-toolkit?session=s1');
    expect(status).toBe(200);

    // The client refuses an unexpected shape rather than rendering an empty
    // catalog, so parsing here is the real host/client contract assertion.
    const parsed = parseInspectorPayload(JSON.parse(body));
    expect(parsed).not.toBeNull();
    expect(parsed?.skills.map((skill) => skill.name)).toEqual(['find-skills', 'lark-im']);
    expect(parsed?.mcp.map((server) => server.server)).toEqual(['doubao-search']);
    expect(parsed?.systemTools.map((tool) => tool.name)).toContain('bash');
  });

  // The preset payload had no shared contract: the client carried its own
  // type copies and its own hand-written parser, either free to drift from
  // what the host emits. Now both halves share preset-contract/preset-wire,
  // and this test drives the real route output through the real parser.
  it('serves preset defaults the client parser validates', async () => {
    const route = hostWithCatalog({
      agentPresets: {
        list: () => Promise.resolve([{ id: 'cordis', name: 'Cordis', trust: 'system', description: 'primary' }]),
        standingKeyFor: () => Promise.resolve({ preset: 'cordis' }),
        composedPreset: () => 'cordis',
      },
      settings: {
        writable: true,
        register: () => ({ get: () => ({ presets: { cordis: ['read'] }, presetSkills: { cordis: ['lark-im'] } }), replace: () => Promise.resolve() }),
      },
    });
    const { status, body } = await get(route.handler, '/api/agent-toolkit/presets');
    expect(status).toBe(200);

    const parsed = parsePresetToolPayload(JSON.parse(body));
    expect(parsed).not.toBeNull();
    const preset = parsed?.presets[0];
    expect(preset?.id).toBe('cordis');
    // Stored defaults must show up as off in the served rows.
    expect(preset?.systemTools.find((tool) => tool.name === 'read')?.enabled).toBe(false);
    expect(preset?.skills.find((skill) => skill.name === 'lark-im')?.enabled).toBe(false);
    expect(parsed?.writable).toBe(true);
  });

  it('groups MCP tools under their server, not as flat system tools', async () => {
    const route = hostWithCatalog();
    const { body } = await get(route.handler, '/api/agent-toolkit?session=s1');
    const parsed = parseInspectorPayload(JSON.parse(body));

    const server = parsed?.mcp[0];
    expect(server?.tools.map((tool) => tool.label)).toEqual(['image_search', 'web_search']);
    // An mcp__ name must never leak into the system-tool list.
    for (const tool of parsed?.systemTools ?? []) {
      expect(tool.name.startsWith('mcp__')).toBe(false);
    }
  });

  it('serves the stats sub-route as its own JSON document', async () => {
    const route = hostWithCatalog();
    const { status, body } = await get(route.handler, '/api/agent-toolkit/stats');
    expect(status).toBe(200);
    const payload = JSON.parse(body) as { logFile?: unknown; blocked?: unknown; records?: unknown };
    expect(typeof payload.logFile).toBe('string');
    expect(payload.blocked).toBeTypeOf('object');
    expect(Array.isArray(payload.records)).toBe(true);
  });
});

describe('the route refuses a non-loopback caller', () => {
  it('answers 403 for a remote address', async () => {
    const route = hostWithCatalog();
    const { status, body } = await get(route.handler, '/api/agent-toolkit', '203.0.113.7');
    expect(status).toBe(403);
    expect(body).toBe('forbidden');
  });
});
