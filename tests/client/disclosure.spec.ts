import { describe, expect, it } from 'vitest';
import {
  MCP_TOOL_ROOT_CLASS,
  ROW_HEADER_CLASS,
  ROW_ROOT_CLASS,
  resolveDisclosure,
} from '../../src/client/disclosure.js';

describe('capability disclosure state', () => {
  it('is collapsed and interactive by default', () => {
    expect(resolveDisclosure(false, false, 'find-skills', '描述')).toEqual({
      open: false,
      disabled: false,
      label: '展开 find-skills 的描述',
    });
  });

  it('reports expanded state with an accessible collapse label', () => {
    expect(resolveDisclosure(true, false, 'find-skills', '描述')).toEqual({
      open: true,
      disabled: false,
      label: '收起 find-skills 的描述',
    });
  });

  it('forces matching detail open and disables a no-feedback toggle while filtering', () => {
    expect(resolveDisclosure(false, true, 'yunxiao', '工具')).toEqual({
      open: true,
      disabled: true,
      label: 'yunxiao 的工具（筛选时保持展开）',
    });
    expect(resolveDisclosure(true, true, 'bash', '描述')).toEqual({
      open: true,
      disabled: true,
      label: 'bash 的描述（筛选时保持展开）',
    });
  });
});

describe('capability row structure contract', () => {
  it('keeps hover geometry on a header rather than the collapsible root', () => {
    expect(ROW_ROOT_CLASS).toBe('');
    expect(MCP_TOOL_ROOT_CLASS).toBe('ci-toolrow');
    expect(ROW_HEADER_CLASS).toBe('ci-row-head');
  });
});
