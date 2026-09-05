import { describe, expect, it } from 'vitest';
import {
  collectLoadRecords,
  collectReplacements,
  decideStates,
  groupMcpTools,
  indexToolResultSeqs,
  prunedLoadSeqs,
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

  it('marks a load shadowed only when its paired RESULT left the surface', () => {
    // 74 stays on the surface; 92 was displaced by a replace (prune/compaction).
    const surface = new Set([74]);
    expect([...shadowedLoadSeqs(loads, resultSeqs, surface)]).toEqual([91]);
  });

  it('treats a missing result as not shadowed (in flight reads as loaded)', () => {
    const surface = new Set<number>();
    const out = shadowedLoadSeqs(loads, resultSeqs, surface);
    expect(out.has(1141)).toBe(false);
  });

  it('treats any surface-resident result as current', () => {
    const surface = new Set([74, 92]);
    expect(shadowedLoadSeqs(loads, resultSeqs, surface).size).toBe(0);
  });
});

describe('prunedLoadSeqs', () => {
  const loads = [
    { seq: 73, skillName: 'find-skills', callId: 'call-73' },
    { seq: 91, skillName: 'lark-shared', callId: 'call-91' },
  ];
  const resultSeqs = new Map([
    ['call-73', 74],
    ['call-91', 92],
  ]);
  const stub = (seq: number, callId: string, text: string) => ({
    type: 'tool/result',
    seq,
    data: { message: { source: { callId }, content: [{ content: [{ type: 'text', text }] }] } },
  });

  it('flags a load whose surface-resident result carries the prune marker', () => {
    const events = [
      stub(74, 'call-73', 'head\n\n[... tool result middle pruned ...]\n\ntail'),
      stub(92, 'call-91', 'a fully intact result'),
    ];
    const surface = new Set([74, 92]);
    expect([...prunedLoadSeqs(loads, resultSeqs, surface, events)]).toEqual([73]);
  });

  it('ignores pruned results that are no longer on the surface', () => {
    // A stub shadowed by a later compaction reports evicted, not pruned.
    const events = [stub(74, 'call-73', 'head [... tool result middle pruned ...] tail')];
    const surface = new Set([92]);
    expect(prunedLoadSeqs(loads, resultSeqs, surface, events).size).toBe(0);
  });

  it('ignores non-result events and unpaired results', () => {
    const events = [
      { type: 'user/message', seq: 50, data: { message: { content: [{ type: 'text', text: '[... tool result middle pruned ...]' }] } } },
      stub(99, 'call-unrelated', '[... tool result middle pruned ...]'),
    ];
    const surface = new Set([50, 99]);
    expect(prunedLoadSeqs(loads, resultSeqs, surface, events as never).size).toBe(0);
  });

  it('tolerates results without readable content blocks', () => {
    const events = [
      // No content at all.
      { type: 'tool/result', seq: 74, data: { message: { source: { callId: 'call-73' } } } },
      // Content that is not a block array.
      { type: 'tool/result', seq: 75, data: { message: { source: { callId: 'call-91' }, content: 'nope' } } },
      // Blocks that are null, non-objects, or nested arrays without text.
      {
        type: 'tool/result',
        seq: 76,
        data: { message: { source: { callId: 'call-91' }, content: [null, 42, { content: [{ type: 'image' }] }] } },
      },
    ];
    const surface = new Set([74, 75, 76]);
    expect(prunedLoadSeqs(loads, resultSeqs, surface, events as never).size).toBe(0);
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

  it('reads pruned when every surviving copy was middle-truncated', () => {
    const loads = [
      { seq: 1, skillName: 'alpha', callId: 'a' },
      { seq: 3, skillName: 'gamma', callId: 'c' },
    ];
    const states = decideStates(available, loads, new Set(), new Set(), new Set([1, 3]));
    expect(states[0]).toMatchObject({ state: 'pruned', loadCount: 1 });
    expect(states[2]).toMatchObject({ state: 'pruned', loadCount: 1 });
  });

  it('prefers loaded when one surviving copy is intact and another is pruned', () => {
    const loads = [
      { seq: 1, skillName: 'alpha', callId: 'a' },
      { seq: 2, skillName: 'alpha', callId: 'b' },
    ];
    const states = decideStates(available, loads, new Set(), new Set(), new Set([1]));
    expect(states[0]).toMatchObject({ state: 'loaded', loadCount: 2 });
  });

  it('reports evicted rather than pruned when every copy left the surface', () => {
    const loads = [{ seq: 1, skillName: 'alpha', callId: 'a' }];
    const states = decideStates(available, loads, new Set([1]), new Set(), new Set([1]));
    expect(states[0]).toMatchObject({ state: 'evicted' });
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

describe('surfaceOp variants', () => {
  it('ignores a surface op that is not a replace', () => {
    // Only 'replace' shrinks the surface; other op kinds carry no range and
    // must not be read as one.
    const events = [
      { seq: 1, surfaceOp: { op: 'truncate', start: 0, end: 5 } },
      { seq: 2, surfaceOp: { op: 'replace', start: 0, end: 5 } },
    ];
    expect(collectReplacements(events as never)).toEqual([{ seq: 2, start: 0, end: 5 }]);
  });

  it('ignores append and absent ops', () => {
    const events = [
      { seq: 1, surfaceOp: 'append' },
      { seq: 2, surfaceOp: null },
      { seq: 3 },
    ];
    expect(collectReplacements(events as never)).toEqual([]);
  });

  it('ignores a replace whose range or seq is not numeric', () => {
    const events = [
      { seq: 1, surfaceOp: { op: 'replace', start: '0', end: 5 } },
      { seq: 2, surfaceOp: { op: 'replace', start: 0, end: null } },
      { seq: '3', surfaceOp: { op: 'replace', start: 0, end: 5 } },
    ];
    expect(collectReplacements(events as never)).toEqual([]);
  });
});
