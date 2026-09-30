/**
 * Both panels render their rows through this helper, so the two behaviours
 * that used to be written twice — and drifted — are pinned here once: a row
 * with detail gets a trigger, a row without one gets a spacer instead so its
 * name still lines up.
 */
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

// Rendering a row pulls in the panel's icon table, and the real primitives
// package cannot be imported outside the host's module graph (it wants CSS
// modules and `clsx`). The shared stub carries every name the resolver touches.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => (await import('./primitives-stub.js')).primitivesStub);

import { chevronIcon, disclosureRow, leadingFor } from '../../src/client/disclosure-row.js';

interface Node {
  readonly type: unknown;
  readonly props: Readonly<Record<string, unknown>>;
}

const asNode = (value: unknown): Node | undefined =>
  React.isValidElement(value) ? (value as unknown as Node) : undefined;

/** Depth-first search for the first descendant matching a predicate. */
function find(node: unknown, match: (element: Node) => boolean): Node | undefined {
  const element = asNode(node);
  if (element === undefined) return undefined;
  if (match(element)) return element;
  const children = element.props['children'];
  for (const child of Array.isArray(children) ? (children as unknown[]) : [children]) {
    const hit = find(child, match);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

const base = {
  rowKey: 'skill:writing',
  expanded: false,
  filtering: false,
  onOpenChange: () => {},
  triggerLabel: 'Expand description for writing',
  className: 'ci-preset-disclosure',
  headerClassName: 'ci-row-head',
  heading: React.createElement('span', null, 'writing'),
  actions: [React.createElement('button', { key: 's' }, 'switch')],
};

describe('disclosureRow', () => {
  it('renders a trigger and a panel when the row has detail', () => {
    const row = disclosureRow({ ...base, detail: 'writes things' });
    const trigger = find(row, (el) => el.props['className'] === 'ci-disclosure-trigger');
    expect(trigger).toBeDefined();
    expect(trigger?.props['aria-label']).toBe('Expand description for writing');
    expect(find(row, (el) => el.props['className'] === 'ci-collapse')).toBeDefined();
  });

  it('renders a spacer instead of an empty trigger when there is no detail', () => {
    const row = disclosureRow({ ...base, spacerClassName: 'ci-preset-spacer' });
    expect(find(row, (el) => el.props['className'] === 'ci-disclosure-trigger')).toBeUndefined();
    const spacer = find(row, (el) => el.props['className'] === 'ci-preset-spacer');
    expect(spacer).toBeDefined();
    expect(spacer?.props['aria-hidden']).toBe(true);
  });

  it('falls back to an inline spacer width when no spacer class is given', () => {
    const row = disclosureRow(base);
    const spacer = find(row, (el) => (el.props['style'] as { width?: string } | undefined)?.width === '18px');
    expect(spacer).toBeDefined();
  });

  // An empty string is detail the user cannot read; it must not buy a trigger.
  it.each([undefined, null, ''])('treats %p as no detail', (detail) => {
    const row = disclosureRow({ ...base, detail });
    expect(find(row, (el) => el.props['className'] === 'ci-disclosure-trigger')).toBeUndefined();
  });

  it('forces detail open while filtering and locks the trigger', () => {
    const row = disclosureRow({ ...base, filtering: true, detail: 'writes things' });
    expect(asNode(row)!.props['open']).toBe(true);
    expect(find(row, (el) => el.props['className'] === 'ci-disclosure-trigger')?.props['disabled']).toBe(true);
  });

  it('reports the user preference when no filter is active', () => {
    const open = disclosureRow({ ...base, expanded: true, detail: 'd' });
    expect(asNode(open)!.props['open']).toBe(true);
    const shut = disclosureRow({ ...base, expanded: false, detail: 'd' });
    expect(asNode(shut)!.props['open']).toBe(false);
  });

  it('reports open changes to the caller', () => {
    const onOpenChange = vi.fn();
    const row = disclosureRow({ ...base, onOpenChange, detail: 'd' });
    (asNode(row)!.props['onOpenChange'] as (open: boolean) => void)(true);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('keeps actions outside the trigger so a switch is not a toggle', () => {
    const row = disclosureRow({ ...base, detail: 'd' });
    const trigger = find(row, (el) => el.props['className'] === 'ci-disclosure-trigger');
    expect(find(trigger, (el) => el.type === 'button' && el.props['children'] === 'switch')).toBeUndefined();
    const header = find(row, (el) => el.props['className'] === 'ci-row-head');
    expect(find(header, (el) => el.type === 'button' && el.props['children'] === 'switch')).toBeDefined();
  });

  // A disabled row is dimmed by its caller, and that has to survive both
  // shapes: the detail-less branch builds its own root element.
  it('passes an optional style through to the row root, with or without detail', () => {
    const withDetail = disclosureRow({ ...base, style: { opacity: 0.55 }, detail: 'd' });
    expect(asNode(withDetail)!.props['style']).toEqual({ opacity: 0.55 });
    const withoutDetail = disclosureRow({ ...base, style: { opacity: 0.55 } });
    expect(asNode(withoutDetail)!.props['style']).toEqual({ opacity: 0.55 });
    expect(asNode(disclosureRow({ ...base, detail: 'd' }))!.props['style']).toBeUndefined();
    expect(asNode(disclosureRow(base))!.props['style']).toBeUndefined();
  });

  it('points the host chevron down while closed and up while open', () => {
    const closed = asNode(chevronIcon(false));
    const open = asNode(chevronIcon(true));
    expect(closed).toBeDefined();
    expect(open).toBeDefined();
    // Two glyphs off the host's icon table, not one glyph turned by CSS: a
    // rotated down-chevron would point sideways, which is the drift this pins.
    expect(closed!.type).not.toBe(open!.type);
  });
});

/**
 * The leading slot with a domain glyph: the host's own row layout, where one
 * box holds the glyph and the chevron and hovering swaps them. Without it a long
 * list of rows reads as a column of arrows — the complaint this shape answers.
 */
describe('leading slot with a domain glyph', () => {
  const icon = React.createElement('i', { className: 'domain' });

  it('shows the glyph while closed and holds the chevron back for hover', () => {
    const row = disclosureRow({ ...base, icon, detail: 'd' });
    expect(find(row, (el) => el.props['className'] === 'ci-row-icon')).toBeDefined();
    expect(find(row, (el) => el.props['className'] === 'ci-chevron ci-chevron-hover')).toBeDefined();
  });

  it('replaces the glyph with the chevron once the row is open', () => {
    // The host's own leading slot is the up-chevron alone while open, so the
    // glyph must not linger beside it.
    const row = disclosureRow({ ...base, expanded: true, icon, detail: 'd' });
    expect(find(row, (el) => el.props['className'] === 'ci-row-icon')).toBeUndefined();
    expect(find(row, (el) => el.props['className'] === 'ci-chevron')).toBeDefined();
  });

  it('keeps the glyph on a row with nothing to reveal, and no spacer', () => {
    const row = disclosureRow({ ...base, icon });
    expect(find(row, (el) => el.props['className'] === 'ci-row-icon')).toBeDefined();
    expect(find(row, (el) => el.props['className'] === 'ci-leading')).toBeDefined();
    expect(asNode(row)!.props['children']).toBeDefined();
  });

  it('lines the leading box up across all three row shapes', () => {
    const shapes = [
      disclosureRow({ ...base, icon, detail: 'd' }),
      disclosureRow({ ...base, icon, expanded: true, detail: 'd' }),
      disclosureRow({ ...base, icon }),
    ];
    for (const row of shapes) {
      expect(find(row, (el) => el.props['className'] === 'ci-leading')).toBeDefined();
    }
  });

  it('keeps the plain chevron for a caller that has no glyph to show', () => {
    const row = disclosureRow({ ...base, detail: 'd' });
    expect(find(row, (el) => el.props['className'] === 'ci-chevron')).toBeDefined();
    expect(find(row, (el) => el.props['className'] === 'ci-leading')).toBeUndefined();
  });

  it('drops to a plain chevron when the caller passes no glyph at all', () => {
    expect(find(leadingFor(undefined, false), (el) => el.props['className'] === 'ci-chevron')).toBeDefined();
    expect(find(leadingFor(undefined, true), (el) => el.props['className'] === 'ci-chevron')).toBeDefined();
  });
});
