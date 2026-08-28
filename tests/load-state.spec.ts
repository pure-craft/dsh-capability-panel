import { describe, expect, it } from 'vitest';
import {
  collectLoadRecords,
  collectReplacements,
  decideStates,
  groupMcpTools,
  indexToolResultSeqs,
  shadowedLoadSeqs,
} from '../src/load-state.js';

function skillCall(seq: number, name: string, callId = `call-${String(seq)}`) {
  return { type: 'tool/call', seq, data: { name: 'skill', arguments: JSON.stringify({ name }), callId } };
}

describe('collectLoadRecords', () => {
  it('picks skill tool/call events with a stringified { name } argument', () => {
    const records = collectLoadRecords([skillCall(1, 'find-skills'), skillCall(5, 'lark-im')]);
    expect(records).toEqual([
      { seq: 1, skillName: 'find-skills', callId: 'call-1' },
      { seq: 5, skillName: 'lark-im', callId: 'call-5' },
    ]);
  });

  it('skips other tools, other event types, and missing seq', () => {
    const events = [
      { type: 'tool/call', seq: 1, data: { name: 'bash', arguments: JSON.stringify({ name: 'x' }) } },
      { type: 'tool/result', seq: 2, data: { name: 'skill', arguments: JSON.stringify({ name: 'x' }) } },
      { type: 'tool/call', data: { name: 'skill', arguments: JSON.stringify({ name: 'x' }) } },
      skillCall(3, 'real'),
    ];
    expect(collectLoadRecords(events).map((r) => r.skillName)).toEqual(['real']);
  });

  it('skips malformed or nameless argument blobs instead of guessing', () => {
    const events = [
      { type: 'tool/call', seq: 1, data: { name: 'skill', arguments: '{not json' } },
      { type: 'tool/call', seq: 2, data: { name: 'skill', arguments: JSON.stringify({ name: '' }) } },
      { type: 'tool/call', seq: 3, data: { name: 'skill', arguments: JSON.stringify({ other: 1 }) } },
      { type: 'tool/call', seq: 4, data: { name: 'skill', arguments: JSON.stringify({ name: 42 }) } },
      { type: 'tool/call', seq: 5, data: { name: 'skill' } },
    ];
    expect(collectLoadRecords(events)).toEqual([]);
  });

  it('defaults callId to empty when the event lacks one', () => {
    const [record] = collectLoadRecords([{ type: 'tool/call', seq: 1, data: { name: 'skill', arguments: JSON.stringify({ name: 'a' }) } }]);
    expect(record?.callId).toBe('');
  });
});

describe('collectReplacements', () => {
  // surfaceOp is TOP-LEVEL in real logs: "append" | { op:'replace', start, end } | null.
  it('keeps only well-formed top-level replace surfaceOps', () => {
    const events = [
      { seq: 1, surfaceOp: { op: 'replace', start: 10, end: 20 } },
      { seq: 2, surfaceOp: 'append' as const },
      { seq: 3, surfaceOp: null },
      { seq: 4, surfaceOp: { op: 'replace', start: 'x' as unknown as number, end: 2 } },
      { seq: 5 },
    ];
    expect(collectReplacements(events)).toEqual([{ seq: 1, start: 10, end: 20 }]);
  });
});

describe('indexToolResultSeqs', () => {
  it('maps message.source.callId to the result seq', () => {
    const events = [
      { type: 'tool/result', seq: 74, data: { message: { source: { callId: 'call-73' } } } },
      { type: 'tool/result', seq: 92, data: { message: { source: { callId: 'call-91' } } } },
      { type: 'tool/call', seq: 91, data: { callId: 'call-91' } },
      { type: 'tool/result', seq: 93, data: { message: { source: {} } } },
      { type: 'tool/result', seq: 94, data: {} },
    ];
    expect([...indexToolResultSeqs(events).entries()]).toEqual([
      ['call-73', 74],
      ['call-91', 92],
    ]);
  });

  it('lets a later prune stub with the same callId supersede the original result', () => {
    // Real-log pattern: middle-pruning appends a stub
    // tool/result carrying the original callId and a replace surfaceOp over
    // the original seq. The stub — not the original — is the node whose fold
    // verdict tracks the surface position, so the callId must resolve to it.
    const events = [
      { type: 'tool/result', seq: 92, data: { message: { source: { callId: 'call-91' } } } },
      { type: 'compaction/prune', seq: 18400 },
      {
        type: 'tool/result',
        seq: 18401,
        surfaceOp: { op: 'replace' as const, start: 92, end: 92 },
        data: { message: { source: { callId: 'call-91' } } },
      },
    ];
    expect(indexToolResultSeqs(events).get('call-91')).toBe(18401);
  });
});

describe('shadowedLoadSeqs', () => {
  const loads = [
    { seq: 73, skillName: 'find-skills', callId: 'call-73' },
    { seq: 91, skillName: 'lark-shared', callId: 'call-91' },
    { seq: 1141, skillName: 'lark-im', callId: 'call-1141' },
  ];
  const resultSeqs = new Map([
    ['call-73', 74],
    ['call-91', 92],
    // call-1141 has no result: in flight.
  ]);

  it('marks a load shadowed only when its paired RESULT is shadowed', () => {
    const surface = new Map([
      [74, 'current'],
      [92, 'shadowed'],
    ]);
    expect([...shadowedLoadSeqs(loads, resultSeqs, surface)]).toEqual([91]);
  });

  it('treats a missing result as not shadowed (in flight reads as loaded)', () => {
    const surface = new Map([
      [74, 'shadowed'],
      [92, 'shadowed'],
    ]);
    const out = shadowedLoadSeqs(loads, resultSeqs, surface);
    expect(out.has(1141)).toBe(false);
  });

  it('ignores verdicts other than shadowed, including log-only', () => {
    const surface = new Map([
      [74, 'log-only'],
      [92, 'current'],
    ]);
    expect(shadowedLoadSeqs(loads, resultSeqs, surface).size).toBe(0);
  });
});

describe('decideStates', () => {
  const available = [
    { name: 'alpha', description: 'A 技能' },
    { name: 'beta' },
    { name: 'gamma', description: 'G 技能' },
  ];

  it('marks skills with no load record as unloaded', () => {
    const states = decideStates(available, [], new Set());
    expect(states.map((s) => s.state)).toEqual(['unloaded', 'unloaded', 'unloaded']);
    expect(states[0]?.loadCount).toBe(0);
  });

  it('loaded when any record survives; evicted only when every record is shadowed', () => {
    const loads = [
      { seq: 1, skillName: 'alpha', callId: 'a' },
      { seq: 2, skillName: 'alpha', callId: 'b' },
      { seq: 3, skillName: 'gamma', callId: 'c' },
    ];
    const shadowed = new Set([1, 3]);
    const states = decideStates(available, loads, shadowed);
    // alpha: seq 1 shadowed but seq 2 survives — a reload after eviction is loaded.
    expect(states[0]).toMatchObject({ state: 'loaded', loadCount: 2 });
    expect(states[1]).toMatchObject({ state: 'unloaded', loadCount: 0 });
    expect(states[2]).toMatchObject({ state: 'evicted', loadCount: 1 });
  });

  it('passes descriptions through and omits the key when absent', () => {
    const states = decideStates(available, [], new Set());
    expect(states[0]?.description).toBe('A 技能');
    expect(states[1]).not.toHaveProperty('description');
  });

  it('marks skills in the disabled set as not enabled, leaving state untouched', () => {
    const loads = [{ seq: 1, skillName: 'alpha', callId: 'a' }];
    const states = decideStates(available, loads, new Set(), new Set(['alpha', 'beta']));
    expect(states[0]).toMatchObject({ state: 'loaded', enabled: false });
    expect(states[1]).toMatchObject({ state: 'unloaded', enabled: false });
    expect(states[2]).toMatchObject({ state: 'unloaded', enabled: true });
  });
});

describe('groupMcpTools', () => {
  it('groups mcp__<server>__<tool> by server, sorted inside and out', () => {
    const groups = groupMcpTools(['mcp__lark__doc', 'mcp__lark__base', 'mcp__fs__read', 'bash']);
    expect(groups).toEqual([
      { server: 'fs', tools: ['read'] },
      { server: 'lark', tools: ['base', 'doc'] },
    ]);
  });

  it('skips names without a tool part or with an empty one', () => {
    expect(groupMcpTools(['mcp__onlyserver', 'mcp__s__', 'mcp____t'])).toEqual([]);
  });
});
