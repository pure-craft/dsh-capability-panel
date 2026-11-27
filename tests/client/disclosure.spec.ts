import { describe, expect, it } from 'vitest';
import { resolveDisclosure } from '../../src/client/disclosure.js';

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
