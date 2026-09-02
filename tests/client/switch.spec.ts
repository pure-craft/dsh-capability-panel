/**
 * One switch serves both panels. These cases pin the states that differ
 * between them -- a settings panel with read-only storage disables the
 * control, a composer panel with no session does too, and either may be
 * mid-write -- so the shared control cannot regress for one caller while
 * still satisfying the other.
 */
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { capabilitySwitch } from '../../src/client/switch.js';

interface Node {
  readonly props: Readonly<Record<string, unknown>>;
}

const root = (element: React.ReactElement): Node => element;

const thumb = (element: React.ReactElement): Node => {
  const children = root(element).props['children'];
  const first = Array.isArray(children) ? (children as unknown[])[0] : children;
  return first as Node;
};

const base = { checked: true, disabled: false, busy: false, label: 'Disable bash', onCheckedChange: () => {} };

describe('capabilitySwitch', () => {
  it('carries the checked state and its accessible name', () => {
    const on = root(capabilitySwitch(base));
    expect(on.props['checked']).toBe(true);
    expect(on.props['aria-label']).toBe('Disable bash');
    expect(on.props['disabled']).toBe(false);
  });

  it('slides the thumb only when checked', () => {
    const on = thumb(capabilitySwitch(base)).props['style'] as { transform: string };
    const off = thumb(capabilitySwitch({ ...base, checked: false })).props['style'] as { transform: string };
    expect(on.transform).toBe('translateX(14px)');
    expect(off.transform).toBe('translateX(0)');
  });

  it.each([
    ['disabled', { disabled: true, busy: false }],
    ['busy', { disabled: false, busy: true }],
    ['both', { disabled: true, busy: true }],
  ])('refuses interaction while %s', (_label, patch) => {
    const node = root(capabilitySwitch({ ...base, ...patch }));
    expect(node.props['disabled']).toBe(true);
    expect((node.props['style'] as { cursor: string }).cursor).toBe('not-allowed');
  });

  // Disabled and busy look different on purpose: a write in flight dims the
  // control, a permanently unavailable one does not pretend to be loading.
  it('dims only while a write is in flight', () => {
    const busy = root(capabilitySwitch({ ...base, busy: true })).props['style'] as { opacity: number };
    const disabled = root(capabilitySwitch({ ...base, disabled: true })).props['style'] as { opacity: number };
    expect(busy.opacity).toBe(0.65);
    expect(disabled.opacity).toBe(1);
  });

  it('stays interactive when it is neither disabled nor busy', () => {
    const node = root(capabilitySwitch(base));
    expect((node.props['style'] as { cursor: string }).cursor).toBe('pointer');
  });

  it('reports changes to the caller', () => {
    const onCheckedChange = vi.fn();
    const node = root(capabilitySwitch({ ...base, onCheckedChange }));
    (node.props['onCheckedChange'] as (checked: boolean) => void)(false);
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });

  // The two panels had drifted here before the control was shared.
  it('keeps one thumb geometry for every caller', () => {
    const style = thumb(capabilitySwitch(base)).props['style'] as Record<string, string>;
    expect(style['borderRadius']).toBe('999px');
    expect(style['transition']).toContain('.12s');
    expect(style['boxShadow']).toBe('0 1px 2px rgba(0,0,0,.22)');
  });
});
