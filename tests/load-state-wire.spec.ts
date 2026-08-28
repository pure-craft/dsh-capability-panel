/**
 * Field-contract tests over the exact event shapes the durable session log uses.
 *
 * These fixtures reproduce shapes read from real logs, not shapes a README
 * suggested. Two earlier versions of `load-state.ts` read `data.call.name` and
 * `data.surfaceOp`, found zero of what they looked for in sessions that had
 * five loads, and reported compacted sessions as never-compacted. Each `it`
 * below pins one field position that mistake got wrong, so a future refactor
 * that reintroduces a nested read fails here instead of silently reading empty.
 */
import { describe, expect, it } from 'vitest';
import {
  collectLoadRecords,
  collectReplacements,
  groupMcpTools,
  indexToolResultSeqs,
  shadowedLoadSeqs,
  type RawEvent,
} from '../src/load-state.js';

/**
 * A skill load exactly as the log stores it: `data.name` is the flat string
 * `"skill"`, and `data.arguments` is a JSON *string*, not an object.
 */
function skillCall(seq: number, skillName: string, callId: string): RawEvent {
  return {
    type: 'tool/call',
    seq,
    surfaceOp: null,
    data: { name: 'skill', arguments: JSON.stringify({ name: skillName }), callId },
  };
}

/** A tool result: the pairing callId sits at `data.message.source.callId`. */
function toolResult(seq: number, callId: string, surfaceOp: RawEvent['surfaceOp'] = 'append'): RawEvent {
  return {
    type: 'tool/result',
    seq,
    surfaceOp,
    data: { message: { source: { callId } } },
  };
}

describe('load record field positions', () => {
  it('reads the tool name from data.name, not data.call.name', () => {
    const flat = collectLoadRecords([skillCall(10, 'find-skills', 'c1')]);
    expect(flat).toEqual([{ seq: 10, skillName: 'find-skills', callId: 'c1' }]);

    // The nested shape a README suggested: it must yield nothing, proving the
    // reader is not accidentally tolerant of both.
    const nested = collectLoadRecords([
      { type: 'tool/call', seq: 10, data: { call: { name: 'skill' } } } as unknown as RawEvent,
    ]);
    expect(nested).toEqual([]);
  });

  it('parses data.arguments as a JSON string, not an object', () => {
    const asObject = collectLoadRecords([
      {
        type: 'tool/call',
        seq: 11,
        data: { name: 'skill', arguments: { name: 'find-skills' }, callId: 'c2' },
      } as unknown as RawEvent,
    ]);
    expect(asObject).toEqual([]);
  });

  it('ignores non-skill tool calls', () => {
    expect(collectLoadRecords([
      { type: 'tool/call', seq: 12, data: { name: 'bash', arguments: '{}', callId: 'c3' } },
    ])).toEqual([]);
  });

  it('skips a load whose arguments blob is malformed', () => {
    expect(collectLoadRecords([
      { type: 'tool/call', seq: 13, data: { name: 'skill', arguments: 'not json', callId: 'c4' } },
    ])).toEqual([]);
  });
});

describe('surfaceOp field position', () => {
  it('reads surfaceOp at the top level, not under data', () => {
    const topLevel = collectReplacements([
      { type: 'tool/result', seq: 20, surfaceOp: { op: 'replace', start: 7, end: 16114 } },
    ]);
    expect(topLevel).toEqual([{ seq: 20, start: 7, end: 16114 }]);

    const underData = collectReplacements([
      { type: 'tool/result', seq: 20, data: { surfaceOp: { op: 'replace', start: 7, end: 16114 } } } as unknown as RawEvent,
    ]);
    expect(underData).toEqual([]);
  });

  it('treats the append string and null as non-replacements', () => {
    expect(collectReplacements([
      { seq: 21, surfaceOp: 'append' },
      { seq: 22, surfaceOp: null },
      { seq: 23 },
    ])).toEqual([]);
  });
});

describe('tool result pairing', () => {
  it('pairs on data.message.source.callId, which a tool/call carries at data.callId', () => {
    const call = skillCall(30, 'lark-im', 'call-abc');
    const result = toolResult(31, 'call-abc');
    const index = indexToolResultSeqs([call, result]);
    expect(index.get('call-abc')).toBe(31);
  });

  it('lets the last write win, so a pruner stub replaces the original result', () => {
    // The middle-pruner appends a stub tool/result carrying the SAME callId and
    // a replace surfaceOp over the original's seq. The stub is the node whose
    // fold verdict tracks the surface position, so it must win.
    const index = indexToolResultSeqs([
      toolResult(40, 'call-x'),
      toolResult(99, 'call-x', { op: 'replace', start: 40, end: 40 }),
    ]);
    expect(index.get('call-x')).toBe(99);
  });

  it('ignores a tool/result with no pairing callId', () => {
    expect(indexToolResultSeqs([{ type: 'tool/result', seq: 41, data: {} }]).size).toBe(0);
  });
});

describe('eviction keys on the paired result, not the call', () => {
  it('marks a load evicted when its paired result folded shadowed', () => {
    const load = { seq: 50, skillName: 'lark-shared', callId: 'c-ev' };
    const resultSeqs = new Map([['c-ev', 51]]);
    const surfaces = new Map([[51, 'shadowed']]);
    expect([...shadowedLoadSeqs([load], resultSeqs, surfaces)]).toEqual([50]);
  });

  it('keeps a load current when its paired result is still on the surface', () => {
    const load = { seq: 52, skillName: 'find-skills', callId: 'c-cur' };
    const resultSeqs = new Map([['c-cur', 53]]);
    const surfaces = new Map([[53, 'current']]);
    expect([...shadowedLoadSeqs([load], resultSeqs, surfaces)]).toEqual([]);
  });

  it('treats an unpaired load as not shadowed, since the model is about to see it', () => {
    const load = { seq: 54, skillName: 'in-flight', callId: 'c-none' };
    expect([...shadowedLoadSeqs([load], new Map(), new Map())]).toEqual([]);
  });
});

describe('MCP tool name grouping', () => {
  it('groups the mcp__<server>__<tool> names this runtime actually exposes', () => {
    const grouped = groupMcpTools([
      'mcp__doubao-search__web_search',
      'mcp__doubao-search__image_search',
      'bash',
      'mcp__other__do_thing',
      'mcp__malformed',
    ]);
    expect(grouped).toEqual([
      { server: 'doubao-search', tools: ['image_search', 'web_search'] },
      { server: 'other', tools: ['do_thing'] },
    ]);
  });

  it('drops a name with no tool part after the second separator', () => {
    expect(groupMcpTools(['mcp__server__', 'mcp____tool'])).toEqual([]);
  });
});
