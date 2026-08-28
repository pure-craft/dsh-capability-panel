import { describe, expect, it } from 'vitest';
import { aggregateBlocked, classifyBlockedCall } from '../src/stats.js';

describe('classifyBlockedCall', () => {
  const disabledSkills = new Set(['lark-im']);
  const disabledMcp = new Set(['mcp__yunxiao__list_pipelines', 'mcp__yunxiao__get_pipeline']);

  it('detects a blocked skill call via the loader error message', () => {
    const hit = classifyBlockedCall(
      {
        name: 'skill',
        arguments: { name: 'lark-im' },
        agent: { id: 's1' },
        error: { message: 'skill "lark-im" is not available for model invocation' },
      },
      disabledSkills,
      disabledMcp,
    );
    expect(hit).toEqual({ kind: 'blocked-skill', name: 'lark-im', sessionId: 's1' });
  });

  it('ignores skill errors for skills nobody disabled', () => {
    const hit = classifyBlockedCall(
      { name: 'skill', arguments: { name: 'other' }, error: { message: 'not available for model invocation' } },
      disabledSkills,
      disabledMcp,
    );
    expect(hit).toBeNull();
  });

  it('ignores successful calls and unrelated skill errors', () => {
    expect(classifyBlockedCall({ name: 'skill', arguments: { name: 'lark-im' } }, disabledSkills, disabledMcp)).toBeNull();
    expect(
      classifyBlockedCall(
        { name: 'skill', arguments: { name: 'lark-im' }, error: { message: 'disk on fire' } },
        disabledSkills,
        disabledMcp,
      ),
    ).toBeNull();
  });

  it('detects a blocked tool call via UNKNOWN_TOOL', () => {
    const hit = classifyBlockedCall(
      {
        name: 'mcp__yunxiao__list_pipelines',
        agent: { id: 's2' },
        error: { message: 'unknown tool', info: { code: 'UNKNOWN_TOOL' } },
      },
      disabledSkills,
      disabledMcp,
    );
    expect(hit).toEqual({ kind: 'blocked-tool', name: 'mcp__yunxiao__list_pipelines', sessionId: 's2' });
  });

  it('detects a guard-denied preset-layer tool via the marker prefix', () => {
    const hit = classifyBlockedCall(
      {
        name: 'bash',
        agent: { id: 's3' },
        error: { message: 'agent-toolkit: tool disabled "bash" (re-enable from the agent toolkit panel)' },
      },
      new Set(),
      new Set(['bash']),
    );
    expect(hit).toEqual({ kind: 'blocked-tool', name: 'bash', sessionId: 's3' });
  });

  it('detects blocked SYSTEM tools the same way', () => {
    const hit = classifyBlockedCall(
      {
        name: 'web_search',
        error: { message: 'unknown tool', info: { code: 'UNKNOWN_TOOL' } },
      },
      new Set(),
      new Set(['web_search']),
    );
    expect(hit).toEqual({ kind: 'blocked-tool', name: 'web_search', sessionId: null });
  });

  it('ignores UNKNOWN_TOOL for tools not disabled (model typos)', () => {
    const hit = classifyBlockedCall(
      { name: 'mcp__yunxiao__typo', error: { message: 'x', info: { code: 'UNKNOWN_TOOL' } } },
      disabledSkills,
      disabledMcp,
    );
    expect(hit).toBeNull();
  });

  it('ignores MCP failures that are not UNKNOWN_TOOL (the body ran)', () => {
    const hit = classifyBlockedCall(
      { name: 'mcp__yunxiao__list_pipelines', error: { message: 'timeout', info: { code: 'ETIMEOUT' } } },
      disabledSkills,
      disabledMcp,
    );
    expect(hit).toBeNull();
  });
});

describe('aggregateBlocked', () => {
  it('counts blocked records by name, skipping toggles and broken lines', () => {
    const lines = [
      JSON.stringify({ ts: 't', sessionId: 's', kind: 'disable', name: 'lark-im' }),
      JSON.stringify({ ts: 't', sessionId: 's', kind: 'blocked-skill', name: 'lark-im' }),
      JSON.stringify({ ts: 't', sessionId: 's', kind: 'blocked-skill', name: 'lark-im' }),
      JSON.stringify({ ts: 't', sessionId: 's', kind: 'blocked-tool', name: 'mcp__a__b' }),
      JSON.stringify({ ts: 't', sessionId: 's', kind: 'blocked-mcp', name: 'mcp__a__c' }),
      'not json',
      '',
    ];
    expect(aggregateBlocked(lines)).toEqual({ 'lark-im': 2, 'mcp__a__b': 1, 'mcp__a__c': 1 });
  });
});
