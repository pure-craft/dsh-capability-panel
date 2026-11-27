import { describe, expect, it } from 'vitest';
import { applyInsights, createInsightsDefinition, initInsights } from '../../src/host/insights-fold.js';
import type { InsightsEvent } from '../../src/host/insights-fold.js';
const event = (type: string, seq: number, data: unknown, time = seq): InsightsEvent => ({ type, seq, time, data });
describe('insights fold', () => {
  it('handles caps, timestamps, malformed wrappers and repeated identities', () => {
    let state = initInsights({ id: 'a', agentPreset: 'base' }, 0);
    expect(applyInsights(state, event('agent-preset/selected', 0, { agentPreset: 'base' }))).toBe(state);
    for (const message of [{}, { source: {} }, { source: { kind: 'skill-invocation', name: '' } }]) expect(applyInsights(state, event('user/message', 0, message))).toBe(state);
    state = applyInsights(state, event('tool/call', 1, { name: 'read' }, NaN));
    state = applyInsights(state, event('tool/call', 2, { name: 'read' }, 5));
    state = applyInsights(state, event('tool/call', 3, { name: 'read' }, 2));
    expect(state.tools['read']).toEqual({ count: 3, lastUsed: 5 });
    for (const content of [undefined, [null, { text: 5 }, { text: 'not a wrapper' }]]) {
      state = applyInsights(state, event('tool/call', 4, { name: 'skill', callId: 's' }));
      state = applyInsights(state, event('tool/call', 5, { name: 'skill', callId: 's' }));
      state = applyInsights(state, event('tool/result', 6, { message: { toolCallId: 's', content } }));
    }
    state = applyInsights(state, event('tool/call', 7, { name: 'skill', callId: 's' }));
    state = applyInsights(state, event('tool/result', 8, { error: {}, message: { toolCallId: 's' } }));
    state.pending = Array.from({ length: 200 }, (_, i) => String(i));
    state = applyInsights(state, event('tool/call', 9, { name: 'skill', callId: 'extra' }));
    expect(state.limited).toBe(true);
    expect(state.pending).toHaveLength(200);
    expect(state.pending).not.toContain('0');
    expect(state.pending).toContain('199');
    expect(state.pending.at(-1)).toBe('extra');
    state.limited = false;
    state.tools = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [String(i), { count: 1, lastUsed: null }]));
    state = applyInsights(state, event('tool/call', 10, { name: 'overflow' }));
    expect(state.limited).toBe(true);
    expect(Object.keys(state.tools)).toHaveLength(2000);
    expect(state.tools).not.toHaveProperty('overflow');
    state = applyInsights(state, event('tool/call', 11, { name: '1999' }));
    expect(state.tools['1999']).toEqual({ count: 2, lastUsed: 11 });
    expect(Object.keys(state.tools)).toHaveLength(2000);
  });
  it('counts calls but only successful paired skill content and explicit invocations', () => {
    let state = initInsights({ id: 'a' }, 0);
    state = applyInsights(state, event('tool/call', 0, { name: 'skill', callId: 's', arguments: '{"name":"fake"}' }));
    expect(state.skills).toEqual({});
    state = applyInsights(state, event('tool/result', 1, { message: { source: { callId: 's' }, content: [{ type: 'text', text: '<skill_content name="real">' }] } }));
    state = applyInsights(state, event('tool/result', 2, { message: { source: { callId: 's' }, content: [{ text: '<skill_content name="real">' }] } }));
    state = applyInsights(state, event('developer/message', 3, { message: { source: { kind: 'skill-invocation', name: 'explicit' } } }));
    expect(state.tools).toEqual({ skill: { count: 1, lastUsed: 0 } });
    expect(state.skills).toEqual({ real: { count: 1, lastUsed: 1 }, explicit: { count: 1, lastUsed: 3 } });
  });
  it('does not duplicate inherited activity but restores inherited preset selections', () => {
    let state = initInsights({ id: 'fork', agentPreset: 'old' }, 3);
    state = applyInsights(state, event('agent-preset/selected', 0, { agentPreset: 'new' }));
    const inherited = applyInsights(state, event('tool/call', 1, { name: 'read' }));
    expect(inherited).toBe(state);
    state = applyInsights(state, event('tool/call', 3, { name: 'read' }));
    expect(state.presetId).toBe('new');
    expect(state.tools['read']?.count).toBe(1);
  });
  it('rejects failures, quotations, missing pairs and malformed events', () => {
    let state = initInsights({ id: 'a' }, 0);
    for (const item of [event('tool/result', 0, { message: { content: [{ text: '<skill_content name="quote">' }] } }), event('tool/call', 1, null), event('ignored', 2, {})]) expect(applyInsights(state, item)).toBe(state);
    state = applyInsights(state, event('tool/call', 3, { name: 'skill', callId: 's' }));
    state = applyInsights(state, event('tool/result', 4, { message: { toolCallId: 's', isError: true, content: [{ text: '<skill_content name="failed">' }] } }));
    expect(state.skills).toEqual({});
    expect(state.pending).toEqual([]);
    expect(createInsightsDefinition().wire.view(state)).toBe(state);
    expect(createInsightsDefinition().stateSchema.parse(state)).toEqual(state);
  });
});
