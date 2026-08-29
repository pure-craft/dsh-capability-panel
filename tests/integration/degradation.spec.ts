/**
 * The host half must degrade rather than fail: a missing or broken service
 * costs one section of the panel, never the whole answer. Every path here
 * reports what it lost through `degraded`, so an empty list is always
 * distinguishable from a list that could not be read — the distinction that a
 * silent `?? []` default would erase.
 */
import { describe, expect, it } from 'vitest';
import { get, hostWithCatalog } from './composition.spec.js';

/** Read the payload the route serves, failing loudly on a non-200. */
async function payloadFrom(route: { handler: (req: unknown, res: unknown) => Promise<void> | void }) {
  const { status, body } = await get(route.handler, '/api/agent-toolkit?session=s1');
  expect(status).toBe(200);
  return JSON.parse(body) as {
    skills: { name: string }[];
    mcp: { server: string }[];
    systemTools: { name: string }[];
    degraded?: string[];
  };
}

describe('a missing service costs one section, not the answer', () => {
  it('reports an absent skills service and still serves the tools', async () => {
    const payload = await payloadFrom(hostWithCatalog({ skills: undefined }));

    expect(payload.skills).toEqual([]);
    expect(payload.degraded).toContain('skills service unavailable');
    // The rest of the catalog is unaffected.
    expect(payload.systemTools.length).toBeGreaterThan(0);
  });

  it('serves an empty tool list when the tools service is absent', async () => {
    const payload = await payloadFrom(hostWithCatalog({ tools: undefined }));

    expect(payload.systemTools).toEqual([]);
    expect(payload.mcp).toEqual([]);
    expect(payload.skills.length).toBeGreaterThan(0);
  });

  it('serves the catalog when the session-query service is absent', async () => {
    // Without the log there is no load state, but the catalog still stands.
    const payload = await payloadFrom(hostWithCatalog({ sessionQuery: undefined }));

    expect(payload.skills.length).toBeGreaterThan(0);
    expect(payload.degraded?.length).toBeGreaterThan(0);
  });

  it('serves the catalog when no agent resolves for the session', async () => {
    const payload = await payloadFrom(hostWithCatalog({ agents: { get: () => undefined } }));

    expect(payload.skills.length).toBeGreaterThan(0);
  });

  it('serves the catalog when the agents service itself is absent', async () => {
    const payload = await payloadFrom(hostWithCatalog({ agents: undefined }));

    expect(payload.skills.length).toBeGreaterThan(0);
  });
});

describe('a throwing service is reported, never swallowed', () => {
  it('records the reason when the skills list rejects', async () => {
    const route = hostWithCatalog({
      skills: {
        list: () => Promise.reject(new Error('registry offline')),
        get: () => Promise.resolve({ name: 'x', description: 'd', content: 'c' }),
      },
    });
    const payload = await payloadFrom(route);

    expect(payload.skills).toEqual([]);
    expect(payload.degraded?.some((note) => note.includes('registry offline'))).toBe(true);
  });

  it('stringifies a non-Error rejection rather than losing it', async () => {
    const route = hostWithCatalog({
      skills: {
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors
        list: () => Promise.reject('registry vanished'),
        get: () => Promise.resolve({ name: 'x', description: 'd', content: 'c' }),
      },
    });
    const payload = await payloadFrom(route);

    expect(payload.degraded?.some((note) => note.includes('registry vanished'))).toBe(true);
  });

  it('records the reason when the session log rejects', async () => {
    const route = hostWithCatalog({
      sessionQuery: {
        readSession: () => Promise.reject(new Error('log unreadable')),
        listEvents: () => Promise.reject(new Error('log unreadable')),
      },
    });
    const payload = await payloadFrom(route);

    expect(payload.skills.length).toBeGreaterThan(0);
    expect(payload.degraded?.length).toBeGreaterThan(0);
  });

  it('rejects an unexpected log shape instead of reading it as no loads', async () => {
    // The guessed `{ events }` wrapper once hid a total read failure behind a
    // clean-looking payload; a wrong shape must surface as degraded.
    const route = hostWithCatalog({
      sessionQuery: {
        readSession: () => Promise.resolve({ notEvents: true }),
        listEvents: () => Promise.resolve({ notAnArray: true }),
      },
    });
    const payload = await payloadFrom(route);

    expect(payload.degraded?.some((note) => note.includes('unexpected shape'))).toBe(true);
  });
});

describe('catalog entries that must be skipped', () => {
  it('drops skills with no usable name', async () => {
    const route = hostWithCatalog({
      skills: {
        list: () =>
          Promise.resolve([
            { name: '', description: 'blank' },
            { name: 42, description: 'not a string' },
            { name: 'real-skill', description: 'kept' },
          ]),
        get: () => Promise.resolve({ name: 'x', description: 'd', content: 'c' }),
      },
    });
    const payload = await payloadFrom(route);

    expect(payload.skills.map((s) => s.name)).toEqual(['real-skill']);
  });

  it('hides a skill the preset marked non-model-invocable', async () => {
    const route = hostWithCatalog({
      skills: {
        list: () =>
          Promise.resolve([
            { name: 'hidden', invocation: { modelInvocable: false } },
            { name: 'visible' },
          ]),
        get: () => Promise.resolve({ name: 'x', description: 'd', content: 'c' }),
      },
    });
    const payload = await payloadFrom(route);

    // A shadow this plugin did not create is the preset's own choice, so the
    // panel must not offer it as something to switch back on.
    expect(payload.skills.map((s) => s.name)).toEqual(['visible']);
  });

  it('keeps a non-string description out of the payload', async () => {
    const route = hostWithCatalog({
      skills: {
        list: () => Promise.resolve([{ name: 'odd', description: 42 }]),
        get: () => Promise.resolve({ name: 'x', description: 'd', content: 'c' }),
      },
    });
    const payload = await payloadFrom(route);

    expect(payload.skills[0]).not.toHaveProperty('description');
  });
});
