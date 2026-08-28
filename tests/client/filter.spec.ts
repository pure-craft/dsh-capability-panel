import { describe, expect, it } from 'vitest';
import type { InspectorPayload } from '../../src/contract.js';
import { filterPayload } from '../../src/client/filter.js';

function payload(): InspectorPayload {
  return {
    sessionId: 's1',
    skills: [
      { name: 'find-skills', state: 'loaded', enabled: true, loadCount: 1, description: '发现技能' },
      { name: 'lark-doc', state: 'unloaded', enabled: true, loadCount: 0, description: '飞书云文档' },
    ],
    mcp: [
      {
        server: 'yunxiao',
        enabled: true,
        tools: [
          { name: 'mcp__yunxiao__list_pipelines', label: 'list_pipelines', enabled: true, description: '流水线列表' },
          { name: 'mcp__yunxiao__get_work_item', label: 'get_work_item', enabled: true, description: '工作项详情' },
        ],
      },
      {
        server: 'playwright',
        enabled: true,
        tools: [{ name: 'mcp__playwright__click', label: 'click', enabled: true, description: '点击元素' }],
      },
    ],
    systemTools: [
      { name: 'bash', label: 'bash', enabled: true, description: '执行 shell 命令' },
      { name: 'read', label: 'read', enabled: true },
    ],
    blocked: {},
  };
}

describe('filterPayload', () => {
  it('returns the payload untouched for a blank query', () => {
    const p = payload();
    const view = filterPayload(p, '   ');
    expect(view.skills).toBe(p.skills);
    expect(view.mcp).toBe(p.mcp);
    expect(view.systemTools).toBe(p.systemTools);
    expect(view.total).toBe(2 + 2 + 2);
  });

  it('matches skills by name and by description, case-insensitively', () => {
    expect(filterPayload(payload(), 'LARK').skills.map((s) => s.name)).toEqual(['lark-doc']);
    expect(filterPayload(payload(), '云文档').skills.map((s) => s.name)).toEqual(['lark-doc']);
  });

  it('keeps every tool when the server name matches', () => {
    const view = filterPayload(payload(), 'yunxiao');
    expect(view.mcp).toHaveLength(1);
    expect(view.mcp[0]?.tools).toHaveLength(2);
  });

  it('narrows a server to only its matching tools', () => {
    const view = filterPayload(payload(), 'pipeline');
    expect(view.mcp).toHaveLength(1);
    expect(view.mcp[0]?.server).toBe('yunxiao');
    expect(view.mcp[0]?.tools.map((t) => t.name)).toEqual(['mcp__yunxiao__list_pipelines']);
  });

  it('drops servers whose tools all miss', () => {
    const view = filterPayload(payload(), '点击');
    expect(view.mcp.map((s) => s.server)).toEqual(['playwright']);
  });

  it('matches system tools by label, name, or description', () => {
    expect(filterPayload(payload(), 'shell').systemTools.map((t) => t.name)).toEqual(['bash']);
    expect(filterPayload(payload(), 'read').systemTools.map((t) => t.name)).toEqual(['read']);
  });

  it('counts visible top-level rows', () => {
    const view = filterPayload(payload(), '工作项');
    expect(view.total).toBe(1); // only the yunxiao server survives
    expect(filterPayload(payload(), 'zzz-no-match').total).toBe(0);
  });
});
