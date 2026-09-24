import { describe, expect, it, vi } from 'vitest';
import { readConfiguredMcpServers, restartMcpServer } from '../../src/host/mcp-connections.js';
import { HttpError } from '../../src/host/errors.js';

function entry(name: unknown, serverName: unknown, options: { disabled?: boolean } = {}) {
  const dispose = vi.fn(() => Promise.resolve());
  const refresh = vi.fn(() => Promise.resolve());
  return {
    disabled: options.disabled === true,
    // The loader carries the package name on options.name, not a top-level field.
    options: { name, config: serverName === undefined ? undefined : { serverName } },
    _dispose: dispose,
    refresh,
  };
}

function hostWith(entries: readonly unknown[]) {
  const loader = { entries: () => entries as never };
  return { get: (name: string) => (name === 'loader' ? loader : undefined) } as never;
}

describe('readConfiguredMcpServers', () => {
  it('collects serverName only from mcp-client entries', () => {
    const servers = readConfiguredMcpServers(hostWith([
      entry('@deepseek-ai/dsh-mcp-client', 'ida'),
      entry('@deepseek-ai/dsh-mcp-client', 'dnspy'),
      // A same-key config on an unrelated plugin is not an MCP server.
      entry('some-other-plugin', 'impostor'),
      entry('@deepseek-ai/dsh-mcp-client', undefined),
      entry('@deepseek-ai/dsh-mcp-client', ''),
      entry('@deepseek-ai/dsh-mcp-client', 42),
      { options: { name: '@deepseek-ai/dsh-mcp-client', config: null }, _dispose: vi.fn(), refresh: vi.fn() },
      { options: { name: '@deepseek-ai/dsh-mcp-client', config: ['ida'] }, _dispose: vi.fn(), refresh: vi.fn() },
      { options: { name: '@deepseek-ai/dsh-mcp-client', config: 'ida' }, _dispose: vi.fn(), refresh: vi.fn() },
      // Duplicate declarations collapse to one name.
      entry('@deepseek-ai/dsh-mcp-client', 'ida'),
    ]));
    expect([...servers].sort()).toEqual(['dnspy', 'ida']);
  });

  it('skips deliberately disabled entries — they are off by config, not offline', () => {
    const servers = readConfiguredMcpServers(hostWith([
      entry('@deepseek-ai/dsh-mcp-client', 'ida'),
      entry('@deepseek-ai/dsh-mcp-client', 'dnspy', { disabled: true }),
    ]));
    expect([...servers]).toEqual(['ida']);
  });

  it('returns empty without a loader and degrades when the walk fails', () => {
    expect(readConfiguredMcpServers({} as never).size).toBe(0);
    const broken = {
      get: (name: string) => (name === 'loader'
        ? {
            *entries() {
              yield entry('@deepseek-ai/dsh-mcp-client', 'ida');
              throw new Error('mid-reload');
            },
          }
        : undefined),
    } as never;
    expect([...readConfiguredMcpServers(broken)]).toEqual(['ida']);
  });
});

describe('restartMcpServer', () => {
  it('disposes then refreshes the matching entry', async () => {
    const target = entry('@deepseek-ai/dsh-mcp-client', 'ida');
    const other = entry('@deepseek-ai/dsh-mcp-client', 'dnspy');
    await restartMcpServer(hostWith([other, target]), 'ida');
    expect(target._dispose).toHaveBeenCalledOnce();
    expect(target.refresh).toHaveBeenCalledOnce();
    expect(other._dispose).not.toHaveBeenCalled();
    expect(other.refresh).not.toHaveBeenCalled();
  });

  it('404s when the server is not configured', async () => {
    await expect(restartMcpServer(hostWith([entry('@deepseek-ai/dsh-mcp-client', 'ida')]), 'ghost'))
      .rejects.toMatchObject({ status: 404 });
    await expect(restartMcpServer({} as never, 'ghost')).rejects.toMatchObject({ status: 404 });
  });

  it('404s when the loader walk fails', async () => {
    const broken = {
      get: (name: string) => (name === 'loader'
        ? {
            *entries(): Generator<never> {
              throw new Error('mid-reload');
            },
          } as never
        : undefined),
    } as never;
    await expect(restartMcpServer(broken, 'ida')).rejects.toMatchObject({ status: 404 });
  });

  it('409s when the entry is disabled in the host composition', async () => {
    const target = entry('@deepseek-ai/dsh-mcp-client', 'ida', { disabled: true });
    await expect(restartMcpServer(hostWith([target]), 'ida')).rejects.toSatisfy((error) => {
      expect(error).toBeInstanceOf(HttpError);
      expect(error).toMatchObject({ status: 409 });
      return true;
    });
    expect(target._dispose).not.toHaveBeenCalled();
    expect(target.refresh).not.toHaveBeenCalled();
  });
});
