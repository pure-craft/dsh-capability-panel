import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createStatsStore, statsFilePath } from '../../src/host/stats-store.js';

const paths: string[] = [];
afterEach(() => {
  for (const path of paths.splice(0)) {
    chmodSync(path, 0o700);
    rmSync(path, { recursive: true, force: true });
  }
});

describe('stats store', () => {
  it('resolves DSH_HOME and the default home consistently', () => {
    expect(statsFilePath({ DSH_HOME: '/state' }, '/home/me')).toBe('/state/agent-toolkit/stats.jsonl');
    expect(statsFilePath({}, '/home/me')).toBe('/home/me/.dsh/agent-toolkit/stats.jsonl');
  });

  it('treats only ENOENT as an empty store', () => {
    const root = mkdtempSync(join(tmpdir(), 'toolkit-stats-'));
    paths.push(root);
    const missing = createStatsStore(join(root, 'missing.jsonl')).read();
    expect(missing).toEqual({ records: [], blocked: {}, warnings: [] });

    const directory = join(root, 'not-a-file');
    mkdirSync(directory);
    const failed = createStatsStore(directory).read();
    expect(failed.records).toEqual([]);
    expect(failed.warnings[0]).toMatch(/stats read failed/);
  });

  it('skips damaged JSONL lines and reports them while aggregating valid records', () => {
    const root = mkdtempSync(join(tmpdir(), 'toolkit-stats-'));
    paths.push(root);
    const file = join(root, 'stats.jsonl');
    writeFileSync(file, [
      JSON.stringify({ ts: 'now', sessionId: 's', kind: 'blocked-tool', name: 'bash' }),
      '{damaged',
      JSON.stringify({ ts: 'now', sessionId: 's', kind: 'disable', name: 'system-tool:bash' }),
      '',
    ].join('\n'));
    const snapshot = createStatsStore(file).read();
    expect(snapshot.records).toHaveLength(2);
    expect(snapshot.blocked).toEqual({ bash: 1 });
    expect(snapshot.warnings).toHaveLength(1);
    expect(snapshot.warnings[0]).toMatch(/line 2 skipped/);
  });

  it('appends records and reports append failures without throwing', () => {
    const root = mkdtempSync(join(tmpdir(), 'toolkit-stats-'));
    paths.push(root);
    const store = createStatsStore(join(root, 'nested', 'stats.jsonl'));
    expect(store.append({ ts: 'now', sessionId: null, kind: 'enable', name: 'skill:x' })).toBeNull();
    expect(store.read().records).toHaveLength(1);
    const failed = createStatsStore(root);
    expect(failed.append({ ts: 'now', sessionId: null, kind: 'enable', name: 'skill:x' })).toMatch(/append failed/);
    expect(failed.read().warnings.some((warning) => warning.includes('append failed'))).toBe(true);
  });
});
