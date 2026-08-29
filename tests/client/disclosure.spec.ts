import { describe, expect, it } from 'vitest';
import {
  MCP_TOOL_ROOT_CLASS,
  ROW_HEADER_CLASS,
  ROW_ROOT_CLASS,
  resolveDisclosure,
} from '../../src/client/disclosure.js';

describe('capability disclosure state', () => {
  it('is collapsed and interactive by default', () => {
    expect(resolveDisclosure(false, false)).toEqual({ open: false, disabled: false });
  });

  it('reports expanded state', () => {
    expect(resolveDisclosure(true, false)).toEqual({ open: true, disabled: false });
  });

  it('forces matching detail open and disables a no-feedback toggle while filtering', () => {
    expect(resolveDisclosure(false, true)).toEqual({ open: true, disabled: true });
    expect(resolveDisclosure(true, true)).toEqual({ open: true, disabled: true });
  });
});

describe('capability row structure contract', () => {
  it('keeps hover geometry on a header rather than the collapsible root', () => {
    expect(ROW_ROOT_CLASS).toBe('');
    expect(MCP_TOOL_ROOT_CLASS).toBe('ci-toolrow');
    expect(ROW_HEADER_CLASS).toBe('ci-row-head');
  });
});
