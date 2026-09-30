import { describe, expect, it, vi } from 'vitest';

import { loadFileAddressFor, previewAddressFor } from '../../src/host/skill-preview.js';

describe('skill preview addresses', () => {
  it('addresses an instruction file through the host helper', async () => {
    const forFile = await loadFileAddressFor();
    expect(forFile).toBeTypeOf('function');
    // Workspace-relative inside the session workspace, absolute outside it —
    // the two forms the host's own skill references produce.
    expect(previewAddressFor(forFile, 's1', '/ws', '/ws/.dsh/skills/demo/SKILL.md'))
      .toBe('dsh-resource://file/session/s1/.dsh/skills/demo/SKILL.md');
    expect(previewAddressFor(forFile, 's1', '/ws', '/home/u/.dsh/skills/demo/SKILL.md'))
      .toBe('dsh-resource://file/session/s1//home/u/.dsh/skills/demo/SKILL.md');
    // A Windows path keeps its drive colon literal, as the host's grammar says.
    expect(previewAddressFor(forFile, 's1', undefined, 'C:/Users/u/.dsh/skills/demo/SKILL.md'))
      .toBe('dsh-resource://file/session/s1/C:/Users/u/.dsh/skills/demo/SKILL.md');
  });

  it('probes the host package once per process', async () => {
    const first = await loadFileAddressFor();
    const second = await loadFileAddressFor();
    expect(second).toBe(first);
  });

  it('reports no address when the host exposes no such helper', async () => {
    vi.resetModules();
    vi.doMock('@deepseek-ai/dsh-util-workspace-path', () => ({ fileAddressFor: 'not a function' }));
    const { loadFileAddressFor: load } = await import('../../src/host/skill-preview.js');
    await expect(load()).resolves.toBeUndefined();
    vi.doUnmock('@deepseek-ai/dsh-util-workspace-path');
  });

  it('reports no address when the package cannot be loaded at all', async () => {
    vi.resetModules();
    vi.doMock('@deepseek-ai/dsh-util-workspace-path', () => { throw new Error('absent'); });
    const { loadFileAddressFor: load } = await import('../../src/host/skill-preview.js');
    await expect(load()).resolves.toBeUndefined();
    vi.doUnmock('@deepseek-ai/dsh-util-workspace-path');
  });

  it('reports no address for a host that cannot be asked at all', () => {
    expect(previewAddressFor(undefined, 's1', '/ws', '/ws/SKILL.md')).toBeUndefined();
  });
});