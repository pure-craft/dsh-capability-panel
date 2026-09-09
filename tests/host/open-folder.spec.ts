import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

import { exec } from 'node:child_process';
import { openFolder } from '../../src/host/open-folder.js';

const execMock = vi.mocked(exec);

function stubPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

function settle(error: Error | null = null): void {
  const call = execMock.mock.calls.at(-1);
  if (call === undefined) throw new Error('exec was not called');
  (call[1] as (error: Error | null) => void)(error);
}

describe('openFolder', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    execMock.mockReset();
  });

  it('runs `open` on macOS', async () => {
    stubPlatform('darwin');
    const pending = openFolder('/tmp/demo');
    expect(execMock).toHaveBeenCalledWith('open "/tmp/demo"', expect.any(Function));
    settle();
    await expect(pending).resolves.toBeUndefined();
  });

  it('runs `start` on Windows', async () => {
    stubPlatform('win32');
    const pending = openFolder('C:\\demo');
    expect(execMock).toHaveBeenCalledWith('start "C:\\demo"', expect.any(Function));
    settle();
    await expect(pending).resolves.toBeUndefined();
  });

  it('runs `xdg-open` on Linux and other platforms', async () => {
    stubPlatform('linux');
    const pending = openFolder('/tmp/demo');
    expect(execMock).toHaveBeenCalledWith('xdg-open "/tmp/demo"', expect.any(Function));
    settle();
    await expect(pending).resolves.toBeUndefined();
  });

  it('rejects with a wrapped message when the opener fails', async () => {
    stubPlatform('darwin');
    const pending = openFolder('/tmp/demo');
    settle(new Error('no such directory'));
    await expect(pending).rejects.toThrow('failed to open folder: no such directory');
  });
});
