import { describe, expect, it, vi } from 'vitest';
import { readConfiguredMcpServers, readRegisteredMcpServers, restartMcpServer } from '../../src/host/mcp-connections.js';

/** The one plugin whose entries declare an MCP server. */
const MCP_CLIENT = '@deepseek-ai/dsh-mcp-client';

interface FakeEntry {
  options?: { id?: unknown; name?: unknown; config?: unknown };
  disabled?: unknown;
  _dispose: () => Promise<void>;
  refresh: () => Promise<void>;
}

/** One loader entry, as the real tree exposes it. */
function entry(config?: unknown, options: { name?: unknown; disabled?: unknown } = {}): FakeEntry {
  return {
    options: { id: 'entry', name: options.name ?? MCP_CLIENT, config },
    ...(options.disabled === undefined ? {} : { disabled: options.disabled }),
    _dispose: vi.fn(() => Promise.resolve()),
    refresh: vi.fn(() => Promise.resolve()),
  };
}

const ctxWith = (services: Record<string, unknown>) => ({ get: (name: string) => services[name] }) as never;

describe('configured MCP servers', () => {
  it('reads the servers the mcp-client entries declare', () => {
    const ctx = ctxWith({
      loader: {
        entries: () => [
          entry({ serverName: 'ida' }),
          entry({ serverName: 'dnspy' }),
          // A second entry for the same server is the same server.
          entry({ serverName: 'ida' }),
          // A serverName-shaped key in another plugin's config is not an MCP
          // server, and inventing a row for it would be a lie about the host.
          entry({ serverName: 'search' }, { name: 'some-other-plugin' }),
          entry({ serverName: 42 }),
          entry({ serverName: '' }),
          entry([]),
          entry(null),
          entry('nope'),
          entry(),
          { _dispose: vi.fn(() => Promise.resolve()), refresh: vi.fn(() => Promise.resolve()) },
        ],
      },
    });

    expect([...readConfiguredMcpServers(ctx).keys()]).toEqual(['ida', 'dnspy']);
    expect(readConfiguredMcpServers(ctx).get('ida')).toEqual({ server: 'ida' });
  });

  it('degrades to no servers when the loader is missing, absent or unreadable', () => {
    expect(readConfiguredMcpServers(ctxWith({})).size).toBe(0);
    const throwing = { get: () => { throw new Error('loader service unavailable'); } } as never;
    expect(readConfiguredMcpServers(throwing).size).toBe(0);
    const midReload = ctxWith({ loader: { entries: () => { throw new Error('tree is mid-reload'); } } });
    expect(readConfiguredMcpServers(midReload).size).toBe(0);
  });
});

describe('registered MCP servers', () => {
  it('names the servers carrying registered tools', () => {
    const ctx = ctxWith({
      tools: {
        schemas: () => [
          { name: 'mcp__ida__list' },
          { name: 'mcp__ida__call' },
          { name: 'mcp__dnspy__types' },
          { name: 'bash' },
          { name: 'mcp__truncated' },
          { name: 42 },
        ],
      },
    });

    expect([...readRegisteredMcpServers(ctx)].sort()).toEqual(['dnspy', 'ida']);
  });

  it('reads an absent or unreadable registry as none', () => {
    expect(readRegisteredMcpServers(ctxWith({})).size).toBe(0);
    const broken = ctxWith({ tools: { schemas: () => { throw new Error('registry failed'); } } });
    expect(readRegisteredMcpServers(broken).size).toBe(0);
  });
});

describe('restarting an MCP server', () => {
  const withTools = (names: readonly unknown[]) => ({ schemas: () => names });

  it('disposes and refreshes the entry, then counts what it registered', async () => {
    const target = entry({ serverName: 'ida' });
    const ctx = ctxWith({
      loader: { entries: () => [entry({ serverName: 'dnspy' }), target] },
      tools: withTools([{ name: 'mcp__ida__list' }, { name: 'mcp__ida__call' }, { name: 'mcp__dnspy__types' }, { name: 'bash' }, { name: 42 }]),
    });

    await expect(restartMcpServer(ctx, 'ida')).resolves.toBe(2);
    expect(target._dispose).toHaveBeenCalledOnce();
    expect(target.refresh).toHaveBeenCalledOnce();
  });

  it('refuses a server the host does not declare', async () => {
    const declared = ctxWith({ loader: { entries: () => [entry({ serverName: 'ida' })] } });
    await expect(restartMcpServer(declared, 'ghost')).rejects.toMatchObject({
      status: 404,
      message: 'MCP server "ghost" is not configured on this host',
    });
    // With no loader at all the answer is the same 404, not a crash.
    await expect(restartMcpServer(ctxWith({}), 'ida')).rejects.toMatchObject({ status: 404 });
    // A tree that throws while walking is equally "not declared here".
    const midReload = ctxWith({ loader: { entries: () => { throw new Error('tree is mid-reload'); } } });
    await expect(restartMcpServer(midReload, 'ida')).rejects.toMatchObject({ status: 404 });
  });

  it('refuses an entry the host composition disabled', async () => {
    const off = entry({ serverName: 'ida' }, { disabled: true });
    const ctx = ctxWith({ loader: { entries: () => [off] } });
    await expect(restartMcpServer(ctx, 'ida')).rejects.toMatchObject({ status: 409 });
    expect(off._dispose).not.toHaveBeenCalled();

    // A falsy flag is not a disabled entry.
    const on = entry({ serverName: 'ida' }, { disabled: false });
    const enabled = ctxWith({ loader: { entries: () => [on] }, tools: withTools([{ name: 'mcp__ida__list' }]) });
    await expect(restartMcpServer(enabled, 'ida')).resolves.toBe(1);
  });

  it('reports zero tools when the registry is gone or unreadable', async () => {
    const noRegistry = ctxWith({ loader: { entries: () => [entry({ serverName: 'ida' })] } });
    await expect(restartMcpServer(noRegistry, 'ida')).resolves.toBe(0);

    const broken = ctxWith({ loader: { entries: () => [entry({ serverName: 'ida' })] }, tools: { schemas: () => { throw new Error('registry failed'); } } });
    await expect(restartMcpServer(broken, 'ida')).resolves.toBe(0);
  });
});
