import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/host/open-folder.js', () => ({
  openFolder: vi.fn(),
}));

import { openFolder } from '../../src/host/open-folder.js';
import { createRouteHandler } from '../../src/host/route.js';

const openFolderMock = vi.mocked(openFolder);

interface FixtureOptions {
  skillsList?: unknown[];
  skillsListThrows?: boolean;
  noSkillsService?: boolean;
  noAgentsService?: boolean;
  agent?: unknown;
  agentPresetsList?: unknown[] | undefined;
  agentPresetsListThrows?: boolean;
  noAgentPresetsService?: boolean;
}

function fixture(options: FixtureOptions = {}) {
  const skills = {
    list: () => options.skillsListThrows === true
      ? Promise.reject(new Error('skills gone'))
      : Promise.resolve(options.skillsList ?? []),
  };
  const agentPresets = {
    list: () => options.agentPresetsListThrows === true
      ? Promise.reject(new Error('presets gone'))
      : Promise.resolve(options.agentPresetsList ?? []),
  };
  const services = {
    get(name: string): unknown {
      if (name === 'skills') return options.noSkillsService === true ? undefined : skills;
      if (name === 'agents') return options.noAgentsService === true ? undefined : { get: () => options.agent };
      if (name === 'agentPresets') return options.noAgentPresetsService === true ? undefined : agentPresets;
      return undefined;
    },
  };
  const payload = { presets: [], writable: true };
  const handler = createRouteHandler(
    services as never,
    { states: new Map(), state: () => undefined, set: () => Promise.resolve(), seed: () => Promise.resolve(), restore: () => Promise.resolve() },
    { file: '/tmp/stats', read: () => ({ blocked: {}, records: [], warnings: [] }) } as never,
    {},
    { list: () => Promise.resolve(payload), set: () => Promise.resolve(payload), setServer: () => Promise.resolve(payload), setSkill: () => Promise.resolve(payload), defaultsFor: () => undefined },
    { overridesFor: () => undefined, record: () => Promise.resolve() },
  );
  return { handler };
}

async function call(fx: ReturnType<typeof fixture>, body?: unknown, method = 'POST', contentType = 'application/json') {
  const listeners = new Map<string, ((value?: unknown) => void)[]>();
  const req = {
    method,
    url: '/api/capability-panel/open-folder',
    headers: { host: '127.0.0.1:3080', 'content-type': contentType },
    socket: { remoteAddress: '127.0.0.1' },
    on(event: string, listener: (value?: unknown) => void) {
      const bucket = listeners.get(event) ?? [];
      bucket.push(listener);
      listeners.set(event, bucket);
      return req;
    },
  };
  let status = 0;
  let text = '';
  const pending = fx.handler(req, {
    writeHead(code: number) { status = code; },
    end(chunk?: string) { text = chunk ?? ''; },
  });
  if (body !== undefined) for (const listener of listeners.get('data') ?? []) listener(JSON.stringify(body));
  for (const listener of listeners.get('end') ?? []) listener();
  await pending;
  return { status, text, json: () => JSON.parse(text) as Record<string, unknown> };
}

describe('open-folder route', () => {
  beforeEach(() => {
    openFolderMock.mockReset();
    openFolderMock.mockResolvedValue(undefined);
    vi.stubEnv('DSH_HOME', '/dsh-home');
    vi.stubEnv('HOME', '/home');
    vi.stubEnv('DSH_AGENTS_HOME', '/agents-home');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects non-POST methods', async () => {
    const result = await call(fixture(), undefined, 'GET');
    expect(result.status).toBe(405);
  });

  it('rejects a non-JSON content type', async () => {
    const result = await call(fixture(), { source: 'user-dsh' }, 'POST', 'text/plain');
    expect(result.status).toBe(415);
  });

  it('rejects a null body', async () => {
    const result = await call(fixture(), null);
    expect(result.status).toBe(400);
  });

  it('rejects a non-object body', async () => {
    const result = await call(fixture(), 'hello');
    expect(result.status).toBe(400);
  });

  it('rejects a missing source', async () => {
    const result = await call(fixture(), { sessionId: 's1' });
    expect(result.status).toBe(400);
    expect(result.json()).toEqual({ error: 'source is required' });
  });

  it('rejects an empty source', async () => {
    const result = await call(fixture(), { source: '' });
    expect(result.status).toBe(400);
  });

  it('opens the live listing directory for a matching source', async () => {
    const fx = fixture({
      agent: { session: { header: { cwd: '/ws' } } },
      skillsList: [
        { name: 'other', source: 'user-agents', resourceBase: { kind: 'directory', path: '/wrong' } },
        { name: 'mine', source: 'custom', resourceBase: { kind: 'directory', path: '/skills/custom' } },
      ],
    });
    const result = await call(fx, { sessionId: 's1', source: 'custom' });
    expect(result.status).toBe(200);
    expect(result.json()).toEqual({ ok: true });
    expect(openFolderMock).toHaveBeenCalledWith('/skills');
  });

  it('skips listing entries without a usable directory resourceBase', async () => {
    const fx = fixture({
      agent: { session: { header: { cwd: '/ws' } } },
      skillsList: [
        { name: 'a', source: 'user-dsh', resourceBase: null },
        { name: 'b', source: 'user-dsh', resourceBase: '/opaque' },
        { name: 'c', source: 'user-dsh', resourceBase: { kind: 'url', url: 'https://x' } },
        { name: 'd', source: 'user-dsh', resourceBase: { kind: 'directory', path: 42 } },
        { name: 'e', source: 'user-dsh', resourceBase: { kind: 'directory', path: '' } },
      ],
    });
    const result = await call(fx, { sessionId: 's1', source: 'user-dsh' });
    expect(result.status).toBe(200);
    expect(openFolderMock).toHaveBeenCalledWith('/dsh-home/skills');
  });

  it('lists without a cwd when the agent has no session', async () => {
    const fx = fixture({
      agent: {},
      skillsList: [{ name: 'a', source: 'custom', resourceBase: { kind: 'directory', path: '/skills/custom' } }],
    });
    const result = await call(fx, { sessionId: 's1', source: 'custom' });
    expect(result.status).toBe(200);
    expect(openFolderMock).toHaveBeenCalledWith('/skills');
  });

  it('falls back when the skills service is unavailable', async () => {
    const fx = fixture({ noSkillsService: true, agent: {} });
    const result = await call(fx, { sessionId: 's1', source: 'user-dsh' });
    expect(result.status).toBe(200);
    expect(openFolderMock).toHaveBeenCalledWith('/dsh-home/skills');
  });

  it('falls back when the agent is unknown', async () => {
    const fx = fixture({ agent: undefined });
    const result = await call(fx, { sessionId: 's1', source: 'user-dsh' });
    expect(result.status).toBe(200);
    expect(openFolderMock).toHaveBeenCalledWith('/dsh-home/skills');
  });

  it('falls back when the agents service is unavailable', async () => {
    const fx = fixture({ noAgentsService: true });
    const result = await call(fx, { sessionId: 's1', source: 'user-dsh' });
    expect(result.status).toBe(200);
    expect(openFolderMock).toHaveBeenCalledWith('/dsh-home/skills');
  });

  it('falls back when listing throws', async () => {
    const fx = fixture({ skillsListThrows: true, agent: {} });
    const result = await call(fx, { sessionId: 's1', source: 'user-dsh' });
    expect(result.status).toBe(200);
    expect(openFolderMock).toHaveBeenCalledWith('/dsh-home/skills');
  });

  it('opens DSH_HOME skills for user-dsh without a session id', async () => {
    const result = await call(fixture(), { source: 'user-dsh' });
    expect(result.status).toBe(200);
    expect(openFolderMock).toHaveBeenCalledWith('/dsh-home/skills');
  });

  it('opens HOME/.dsh skills for user-dsh when DSH_HOME is unset', async () => {
    vi.stubEnv('DSH_HOME', undefined);
    const result = await call(fixture(), { source: 'user-dsh' });
    expect(result.status).toBe(200);
    expect(openFolderMock).toHaveBeenCalledWith('/home/.dsh/skills');
  });

  it('returns 404 for user-dsh when no home is known', async () => {
    vi.stubEnv('DSH_HOME', undefined);
    vi.stubEnv('HOME', undefined);
    const result = await call(fixture(), { source: 'user-dsh' });
    expect(result.status).toBe(404);
    expect(openFolderMock).not.toHaveBeenCalled();
  });

  it('opens DSH_AGENTS_HOME skills for user-agents', async () => {
    const result = await call(fixture(), { source: 'user-agents' });
    expect(result.status).toBe(200);
    expect(openFolderMock).toHaveBeenCalledWith('/agents-home/skills');
  });

  it('opens HOME/.agents skills for user-agents when DSH_AGENTS_HOME is unset', async () => {
    vi.stubEnv('DSH_AGENTS_HOME', undefined);
    const result = await call(fixture(), { source: 'user-agents' });
    expect(result.status).toBe(200);
    expect(openFolderMock).toHaveBeenCalledWith('/home/.agents/skills');
  });

  it('resolves project-dsh from the session cwd', async () => {
    const fx = fixture({ agent: { session: { header: { cwd: '/ws' } } } });
    const result = await call(fx, { sessionId: 's1', source: 'project-dsh' });
    expect(result.status).toBe(200);
    expect(openFolderMock).toHaveBeenCalledWith('/ws/.dsh/skills');
  });

  it('resolves project-agents from the session cwd', async () => {
    const fx = fixture({ agent: { session: { header: { cwd: '/ws' } } } });
    const result = await call(fx, { sessionId: 's1', source: 'project-agents' });
    expect(result.status).toBe(200);
    expect(openFolderMock).toHaveBeenCalledWith('/ws/.agents/skills');
  });

  it('resolves project sources from the process cwd without a session id', async () => {
    // The settings page lists project rows against the dsh process's own
    // workspace, so the sessionless fallback opens that same root.
    const result = await call(fixture(), { source: 'project-dsh' });
    expect(result.status).toBe(200);
    expect(openFolderMock).toHaveBeenCalledWith(`${process.cwd()}/.dsh/skills`);
  });

  it('returns 404 for project sources when the agent is unknown', async () => {
    const fx = fixture({ agent: undefined });
    const result = await call(fx, { sessionId: 's1', source: 'project-dsh' });
    expect(result.status).toBe(404);
  });

  it('returns 404 for project sources when the agent reports no cwd', async () => {
    const fx = fixture({ agent: {} });
    const result = await call(fx, { sessionId: 's1', source: 'project-dsh' });
    expect(result.status).toBe(404);
  });

  it('opens DSH_HOME for the host source', async () => {
    const result = await call(fixture(), { source: 'host' });
    expect(result.status).toBe(200);
    expect(openFolderMock).toHaveBeenCalledWith('/dsh-home');
  });

  it('opens HOME/.dsh for the host source when DSH_HOME is unset', async () => {
    vi.stubEnv('DSH_HOME', undefined);
    const result = await call(fixture(), { source: 'host' });
    expect(result.status).toBe(200);
    expect(openFolderMock).toHaveBeenCalledWith('/home/.dsh');
  });

  it('returns 404 for the host source when no home is known', async () => {
    vi.stubEnv('DSH_HOME', undefined);
    vi.stubEnv('HOME', undefined);
    const result = await call(fixture(), { source: 'host' });
    expect(result.status).toBe(404);
  });

  it('resolves a preset name through the preset registry', async () => {
    const fx = fixture({ agentPresetsList: [{ id: 'x', name: 'my-preset', path: '/presets/mine' }] });
    const result = await call(fx, { source: 'my-preset' });
    expect(result.status).toBe(200);
    expect(openFolderMock).toHaveBeenCalledWith('/presets/mine');
  });

  it('resolves a preset id through the preset registry', async () => {
    const fx = fixture({ agentPresetsList: [{ id: 'my-id', name: 'other', path: '/presets/mine' }] });
    const result = await call(fx, { source: 'my-id' });
    expect(result.status).toBe(200);
    expect(openFolderMock).toHaveBeenCalledWith('/presets/mine');
  });

  it('returns 404 when no preset matches the source', async () => {
    const fx = fixture({ agentPresetsList: [{ id: 'x', name: 'y', path: '/p' }] });
    const result = await call(fx, { source: 'nope' });
    expect(result.status).toBe(404);
  });

  it('returns 404 when the preset registry is unavailable', async () => {
    const fx = fixture({ noAgentPresetsService: true });
    const result = await call(fx, { source: 'nope' });
    expect(result.status).toBe(404);
  });

  it('returns 404 when the preset lookup throws', async () => {
    const fx = fixture({ agentPresetsListThrows: true });
    const result = await call(fx, { source: 'nope' });
    expect(result.status).toBe(404);
  });

  it('returns 404 for a bundled source with no live listing match', async () => {
    const fx = fixture({ agentPresetsListThrows: true });
    const result = await call(fx, { source: 'bundled' });
    expect(result.status).toBe(404);
  });

  it('returns 404 for a runtime source with no live listing match', async () => {
    const fx = fixture({ agentPresetsListThrows: true });
    const result = await call(fx, { source: 'runtime' });
    expect(result.status).toBe(404);
  });

  it('reports 500 when the opener fails', async () => {
    openFolderMock.mockRejectedValue(new Error('cannot open'));
    const result = await call(fixture(), { source: 'user-dsh' });
    expect(result.status).toBe(500);
    expect(result.json()).toEqual({ error: 'failed to open folder: cannot open' });
  });
});
