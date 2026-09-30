import { describe, expect, it, vi } from 'vitest';

import { openSourceFolder } from '../../src/host/open-source-folder.js';
import type { SessionControllerLike } from '../../src/host/types.js';

function opener(overrides: Partial<SessionControllerLike> = {}): SessionControllerLike {
  return {
    canOpenWorkspacePath: () => true,
    openWorkspacePath: () => Promise.resolve(undefined),
    ...overrides,
  };
}

describe('openSourceFolder', () => {
  it('opens through the Host and leaves the fallback alone', async () => {
    const openWorkspacePath = vi.fn(() => Promise.resolve(undefined));
    const fallback = vi.fn(() => Promise.resolve());
    await expect(openSourceFolder(opener({ openWorkspacePath }), '/ws/.dsh/skills', fallback)).resolves.toBe('host');
    expect(openWorkspacePath).toHaveBeenCalledWith({ path: '/ws/.dsh/skills' }, expect.any(AbortSignal));
    expect(fallback).not.toHaveBeenCalled();
  });

  it('falls back when the Host refuses to verify the path', async () => {
    // The sandboxed deployment's answer: a path outside the composed
    // filesystem's roots. This plugin's own opener never claimed that
    // guarantee, so it still applies here.
    const openWorkspacePath = vi.fn(() => Promise.reject(new Error('Path has no verified Host path')));
    const fallback = vi.fn(() => Promise.resolve());
    await expect(openSourceFolder(opener({ openWorkspacePath }), '/home/u/.dsh', fallback)).resolves.toBe('local');
    expect(fallback).toHaveBeenCalledWith('/home/u/.dsh');
  });

  it('opens nothing when the deployment says no desktop can receive the path', async () => {
    // `false` is the deployment's own answer, so trying our opener would only
    // reproduce the silent failure this design exists to remove.
    const openWorkspacePath = vi.fn(() => Promise.resolve(undefined));
    const fallback = vi.fn(() => Promise.resolve());
    const noDesktop = opener({ canOpenWorkspacePath: () => false, openWorkspacePath });
    await expect(openSourceFolder(noDesktop, '/ws', fallback)).resolves.toBe('unsupported');
    expect(openWorkspacePath).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('falls back when the composition mounts no Session controller', async () => {
    const fallback = vi.fn(() => Promise.resolve());
    await expect(openSourceFolder(undefined, '/ws', fallback)).resolves.toBe('local');
    expect(fallback).toHaveBeenCalledWith('/ws');
  });

  it('falls back for a partial service that carries only one of the two members', async () => {
    const fallback = vi.fn(() => Promise.resolve());
    const canOpenOnly = { canOpenWorkspacePath: () => true } as unknown as SessionControllerLike;
    const openOnly = { openWorkspacePath: () => Promise.resolve(undefined) } as unknown as SessionControllerLike;
    await expect(openSourceFolder(canOpenOnly, '/a', fallback)).resolves.toBe('local');
    await expect(openSourceFolder(openOnly, '/b', fallback)).resolves.toBe('local');
    expect(fallback).toHaveBeenNthCalledWith(1, '/a');
    expect(fallback).toHaveBeenNthCalledWith(2, '/b');
  });

  it('propagates a fallback failure to the caller', async () => {
    await expect(
      openSourceFolder(undefined, '/ws', () => Promise.reject(new Error('no file manager'))),
    ).rejects.toThrow('no file manager');
  });
});