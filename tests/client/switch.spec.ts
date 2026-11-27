/**
 * One switch serves both panels, and two host generations: dsh 0.1.7 ships a
 * design-system Switch the panel adopts outright, older hosts get the local
 * Base UI rendition. These cases pin BOTH paths — the host component receives
 * the full state mapping, and the legacy fallback keeps its geometry — so a
 * regression on either generation is caught here.
 */
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

// The real primitives package imports CSS and cannot execute under Node. The
// mock's `Switch` export is a getter so each test can choose the host
// generation: defined = 0.1.7+, undefined = legacy.
const mockState = vi.hoisted(() => ({ switchImpl: undefined as unknown }));
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  get Switch() {
    return mockState.switchImpl;
  },
}));

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

describe('capabilitySwitch on a 0.1.7+ host (design-system Switch)', () => {
  it('delegates to the host Switch with the full state mapping', () => {
    const HostSwitch = vi.fn(() => null);
    mockState.switchImpl = HostSwitch;
    const element = root(capabilitySwitch(base));
    expect(element.props['checked']).toBe(true);
    expect(element.props['label']).toBe('Disable bash');
    expect(element.props['disabled']).toBe(false);
    expect(element.props['onChange']).toBe(base.onCheckedChange);
    expect((element as unknown as { type: unknown }).type).toBe(HostSwitch);
  });

  it.each([
    ['disabled', { disabled: true, busy: false }],
    ['busy', { disabled: false, busy: true }],
    ['both', { disabled: true, busy: true }],
  ])('maps %s to the host control’s own disabled state', (_label, patch) => {
    mockState.switchImpl = () => null;
    expect(root(capabilitySwitch({ ...base, ...patch })).props['disabled']).toBe(true);
  });

  it('wraps the host capsule in the scaling foot box when small', () => {
    const HostSwitch = vi.fn(() => null);
    mockState.switchImpl = HostSwitch;
    const wrapper = root(capabilitySwitch({ ...base, small: true }));
    expect(wrapper.props['className']).toBe('ci-switch-sm');
    const children = wrapper.props['children'] as React.ReactElement;
    expect((children as unknown as { type: unknown }).type).toBe(HostSwitch);
  });
});

describe('capabilitySwitch on a legacy host (local rendition)', () => {
  it('carries the checked state and its accessible name', () => {
    mockState.switchImpl = undefined;
    const on = root(capabilitySwitch(base));
    expect(on.props['checked']).toBe(true);
    expect(on.props['aria-label']).toBe('Disable bash');
    expect(on.props['disabled']).toBe(false);
  });

  it('slides the thumb only when checked', () => {
    mockState.switchImpl = undefined;
    const on = thumb(capabilitySwitch(base)).props['style'] as { transform: string };
    const off = thumb(capabilitySwitch({ ...base, checked: false })).props['style'] as { transform: string };
    expect(on.transform).not.toBe(off.transform);
    expect(off.transform).toMatch(/^translateX\(0(?:px)?\)$/);
  });

  it.each([
    ['disabled', { disabled: true, busy: false }],
    ['busy', { disabled: false, busy: true }],
    ['both', { disabled: true, busy: true }],
  ])('passes disabled state while %s', (_label, patch) => {
    mockState.switchImpl = undefined;
    const node = root(capabilitySwitch({ ...base, ...patch }));
    expect(node.props['disabled']).toBe(true);
    expect((node.props['style'] as { cursor: string }).cursor).toBe('not-allowed');
  });

  // Disabled and busy look different on purpose: a write in flight dims the
  // control, a permanently unavailable one does not pretend to be loading.
  it('dims only while a write is in flight', () => {
    mockState.switchImpl = undefined;
    const busy = root(capabilitySwitch({ ...base, busy: true })).props['style'] as { opacity: number };
    const disabled = root(capabilitySwitch({ ...base, disabled: true })).props['style'] as { opacity: number };
    expect(busy.opacity).toBe(0.65);
    expect(disabled.opacity).toBe(1);
  });

  it('stays interactive when it is neither disabled nor busy', () => {
    mockState.switchImpl = undefined;
    const node = root(capabilitySwitch(base));
    expect((node.props['style'] as { cursor: string }).cursor).toBe('pointer');
  });

  it('reports changes to the caller', () => {
    mockState.switchImpl = undefined;
    const onCheckedChange = vi.fn();
    const node = root(capabilitySwitch({ ...base, onCheckedChange }));
    (node.props['onCheckedChange'] as (checked: boolean) => void)(false);
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });

  it('keeps the thumb inside both track sizes, and makes the small track smaller', () => {
    mockState.switchImpl = undefined;
    const widths: number[] = [];
    for (const small of [false, true]) {
      const element = capabilitySwitch({ ...base, small });
      const track = root(element).props['style'] as Record<string, string>;
      const knob = thumb(element).props['style'] as Record<string, string>;
      const width = Number.parseFloat(track['width']!);
      const height = Number.parseFloat(track['height']!);
      const diameter = Number.parseFloat(knob['width']!);
      const inset = Number.parseFloat(knob['margin']!);
      const offset = Number.parseFloat(knob['transform']!.match(/^translateX\((.+)px\)$/)?.[1] ?? 'NaN');
      expect(diameter).toBeGreaterThan(0);
      expect(Number.parseFloat(knob['height']!)).toBe(diameter);
      expect(diameter + 2 * inset).toBe(height);
      expect(offset + diameter + 2 * inset).toBe(width);
      widths.push(width);
    }
    expect(widths[1]).toBeLessThan(widths[0]!);
  });
});