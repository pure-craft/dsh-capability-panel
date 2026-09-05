/**
 * HMR-safety: every contribution the host half registers must be removable.
 *
 * The gate is not "apply() ran" but "disposing the fiber leaves nothing
 * behind". A registration that outlives its fiber is exactly the leak that
 * makes a hot reload accumulate duplicate routes, duplicate guards, and
 * duplicate skill shadows until the session misbehaves in ways no unit test
 * of the pure helpers can see.
 *
 * The fake host below records what each verb was handed and reports whether
 * each disposer ran, so a refactor that registers outside `ctx.effect()` — or
 * forgets to release the per-session masks — fails here.
 */
import { describe, expect, it } from 'vitest';
import { apply } from '../../src/index.js';

interface RouteSpec {
  kind: 'prefix';
  path: string;
  handler: (req: unknown, res: unknown) => Promise<void> | void;
}

/**
 * A host recording every registration and every disposal.
 *
 * `runEffects()` mirrors what Cordis does with `ctx.effect(factory)`: it calls
 * the factory and keeps the returned disposer. `dispose()` mirrors fiber
 * teardown, running them in reverse registration order.
 */
function fakeHost() {
  const routes: RouteSpec[] = [];
  const routeDisposed: string[] = [];
  let guardDisposed = false;
  let guardRegistered = false;
  const effectFactories: (() => (() => void) | void)[] = [];
  const effectLabels: (string | undefined)[] = [];
  const listeners = new Map<string, unknown[]>();
  const skillShadows: { name: string; disposed: boolean }[] = [];
  let promptNote: { name: string; disposed: boolean } | null = null;

  const scopedSkills = {
    register(skill: { name: string }) {
      const entry = { name: skill.name, disposed: false };
      skillShadows.push(entry);
      return () => {
        entry.disposed = true;
      };
    },
  };

  const scopedSystemPrompt = {
    context(spec: { name: string }) {
      promptNote = { name: spec.name, disposed: false };
      return () => {
        if (promptNote !== null) promptNote.disposed = true;
      };
    },
  };

  const agent = {
    ctx: {
      get(name: string) {
        if (name === 'skills') return scopedSkills;
        if (name === 'systemPrompt') return scopedSystemPrompt;
        return undefined;
      },
    },
    session: {
          header: { cwd: '/tmp/fake-session' },
          snapshotEvents: () => [],
          surface: { nodes: [] },
        },
  };

  const ctx = {
    webServer: {
      register(spec: RouteSpec) {
        routes.push(spec);
        return () => {
          routeDisposed.push(spec.path);
        };
      },
    },
    agents: {
      get(sessionId: string) {
        return sessionId === 'missing' ? undefined : agent;
      },
    },
    skills: {
      list: () => Promise.resolve([{ name: 'find-skills', description: 'discover skills' }]),
      get: (name: string) =>
        Promise.resolve({ name, description: `desc of ${name}`, content: `body of ${name}` }),
    },
    tools: {
      schemas: () => [{ name: 'bash', description: 'run a command' }],
      guard(_guard: unknown) {
        guardRegistered = true;
        return () => {
          guardDisposed = true;
        };
      },
    },
    on(event: string, listener: unknown) {
      const bucket = listeners.get(event);
      if (bucket === undefined) listeners.set(event, [listener]);
      else bucket.push(listener);
    },
    effect(factory: () => (() => void) | void, label?: string) {
      effectFactories.push(factory);
      effectLabels.push(label);
    },
    get(name: string): unknown {
      return (ctx as unknown as Record<string, unknown>)[name];
    },
  };

  const disposers: (() => void)[] = [];

  return {
    ctx,
    routes,
    routeDisposed,
    effectLabels,
    listeners,
    skillShadows,
    get promptNote() {
      return promptNote;
    },
    get guardRegistered() {
      return guardRegistered;
    },
    get guardDisposed() {
      return guardDisposed;
    },
    /** Cordis runs each effect factory and retains the disposer it returns. */
    runEffects(): void {
      for (const factory of effectFactories) {
        const disposer = factory();
        if (typeof disposer === 'function') disposers.push(disposer);
      }
    },
    /** Fiber teardown: reverse order, like Cordis unwinds a scope. */
    dispose(): void {
      for (const disposer of disposers.reverse()) disposer();
    },
    routeHandler(): RouteSpec['handler'] {
      const route = routes[0];
      if (route === undefined) throw new Error('no route registered');
      return route.handler;
    },
  };
}

describe('every registration goes through ctx.effect', () => {
  it('registers the data route lazily, so effect owns its disposal', () => {
    const host = fakeHost();
    apply(host.ctx as never);

    // Before effects run, the route must NOT exist: registering eagerly and
    // handing the disposer to effect would unregister it immediately.
    expect(host.routes).toEqual([]);

    host.runEffects();
    expect(host.routes).toHaveLength(1);
    expect(host.routes[0]?.path).toBe('/api/capability-panel');
  });

  it('labels every effect, so a leak is attributable in diagnostics', () => {
    const host = fakeHost();
    apply(host.ctx as never);
    host.runEffects();

    expect(host.effectLabels).toContain('capability-panel: tool guard');
    expect(host.effectLabels).toContain('capability-panel: capability masks');
    expect(host.effectLabels).toContain('capability-panel: data route');
    for (const label of host.effectLabels) {
      expect(label).toMatch(/^capability-panel: /);
    }
  });

  it('removes the route when the fiber unwinds', () => {
    const host = fakeHost();
    apply(host.ctx as never);
    host.runEffects();
    expect(host.routeDisposed).toEqual([]);

    host.dispose();
    expect(host.routeDisposed).toEqual(['/api/capability-panel']);
  });

  it('removes the execution guard when the fiber unwinds', () => {
    const host = fakeHost();
    apply(host.ctx as never);
    expect(host.guardRegistered).toBe(true);
    expect(host.guardDisposed).toBe(false);

    host.runEffects();
    host.dispose();
    expect(host.guardDisposed).toBe(true);
  });
});

describe('per-session masks are released on teardown', () => {
  /** Drive a POST through the real route handler, as the browser would. */
  async function toggle(
    host: ReturnType<typeof fakeHost>,
    body: { kind: string; name: string; enabled: boolean },
  ): Promise<{ status: number; payload: unknown }> {
    const handler = host.routeHandler();
    let status = 0;
    let text = '';
    const listeners = new Map<string, ((arg?: unknown) => void)[]>();
    const req = {
      method: 'POST',
      url: '/api/capability-panel?session=s1',
      headers: { host: '127.0.0.1:3080', 'content-type': 'application/json' },
      socket: { remoteAddress: '127.0.0.1' },
      on(event: string, listener: (arg?: unknown) => void) {
        const bucket = listeners.get(event);
        if (bucket === undefined) listeners.set(event, [listener]);
        else bucket.push(listener);
        return req;
      },
    };
    const res = {
      writeHead(code: number) {
        status = code;
      },
      end(chunk?: string) {
        text = chunk ?? '';
      },
    };

    const pending = handler(req, res);
    for (const listener of listeners.get('data') ?? []) listener(JSON.stringify(body));
    for (const listener of listeners.get('end') ?? []) listener();
    await pending;

    let payload: unknown = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
    return { status, payload };
  }

  it('disposes a skill shadow registered through the route', async () => {
    const host = fakeHost();
    apply(host.ctx as never);
    host.runEffects();

    const result = await toggle(host, { kind: 'skill', name: 'find-skills', enabled: false });
    expect(result.status).toBe(200);
    expect(host.skillShadows).toHaveLength(1);
    expect(host.skillShadows[0]).toMatchObject({ name: 'find-skills', disposed: false });

    host.dispose();
    expect(host.skillShadows[0]?.disposed).toBe(true);
  });

  it('disposes the prompt note registered alongside the first mask', async () => {
    const host = fakeHost();
    apply(host.ctx as never);
    host.runEffects();

    await toggle(host, { kind: 'skill', name: 'find-skills', enabled: false });
    expect(host.promptNote).toMatchObject({
      name: 'capability-panel:disabled-capabilities',
      disposed: false,
    });

    host.dispose();
    expect(host.promptNote?.disposed).toBe(true);
  });

  it('re-enabling disposes the shadow immediately, without waiting for teardown', async () => {
    const host = fakeHost();
    apply(host.ctx as never);
    host.runEffects();

    await toggle(host, { kind: 'skill', name: 'find-skills', enabled: false });
    expect(host.skillShadows[0]?.disposed).toBe(false);

    await toggle(host, { kind: 'skill', name: 'find-skills', enabled: true });
    expect(host.skillShadows[0]?.disposed).toBe(true);
  });

  it('is idempotent: disposing twice must not throw', () => {
    const host = fakeHost();
    apply(host.ctx as never);
    host.runEffects();
    host.dispose();
    expect(() => {
      host.dispose();
    }).not.toThrow();
  });
});

describe('apply degrades instead of throwing', () => {
  it('registers nothing when the web server is absent', () => {
    const host = fakeHost();
    // Omit the property rather than set it to undefined: with
    // exactOptionalPropertyTypes the two are different, and a host that lacks
    // the service is the case this asserts.
    const { webServer: _webServer, ...ctxWithoutServer } = host.ctx;
    expect(() => {
      apply(ctxWithoutServer as never);
    }).not.toThrow();
    host.runEffects();
    expect(host.routes).toEqual([]);
  });

  it('still applies when the tools service exposes no guard', () => {
    const host = fakeHost();
    const ctxWithoutGuard = {
      ...host.ctx,
      tools: { schemas: host.ctx.tools.schemas },
    };
    expect(() => {
      apply(ctxWithoutGuard as never);
    }).not.toThrow();
  });
});
