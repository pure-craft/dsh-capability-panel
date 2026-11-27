import { describe, expect, it } from 'vitest';
import { parseInsightsPayload } from '../src/insights-wire.js';

const valid = () => ({ scope: 'global', cwd: null, presetId: null, coverage: { knownSessions: 1, indexedSessions: 1, complete: true, unknown: false }, tools: [{ name: 'read', count: 2, lastUsed: 1 }], skills: [], presets: [{ presetId: null, sessions: 1, toolCalls: 2, skillCalls: 0, lastUsed: null }], warnings: ['test'] });
describe('insights wire', () => {
  it('reads metadata without retaining untrusted extra fields', () => {
    expect(parseInsightsPayload({ ...valid(), arguments: 'secret' })).toEqual(valid());
    expect(parseInsightsPayload({ ...valid(), scope: 'workspace', cwd: '/workspace', presetId: 'dev' }).scope).toBe('workspace');
  });
  it.each([null, [], {}, { ...valid(), scope: 'other' }, { ...valid(), cwd: 1 }, { ...valid(), coverage: { ...valid().coverage, complete: 1 } }, { ...valid(), tools: {} }, { ...valid(), tools: [{ name: '', count: 0, lastUsed: null }] }, { ...valid(), tools: [{ name: 'read', count: -1, lastUsed: null }] }, { ...valid(), tools: [{ name: 'read', count: 0, lastUsed: Infinity }] }, { ...valid(), warnings: [1] }])('rejects malformed response %#', value => {
    expect(() => parseInsightsPayload(value)).toThrow();
  });
});
