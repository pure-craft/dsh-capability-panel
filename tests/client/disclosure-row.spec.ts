/**
 * Both panels render their rows through this helper, so the two behaviours
 * that used to be written twice — and drifted — are pinned here once: a row
 * with detail gets a trigger, a row without one gets a spacer instead so its
 * name still lines up.
 */
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { chevronIcon, disclosureRow } from '../../src/client/disclosure-row.js';

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

  it('ships one chevron for both panels', () => {
    expect(React.isValidElement(chevronIcon)).toBe(true);
  });
});
