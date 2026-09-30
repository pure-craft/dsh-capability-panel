import * as React from 'react';
import { Collapsible } from '@base-ui/react/collapsible';
import { resolveDisclosure } from './disclosure.js';
import { IconChevronDown, IconChevronUp } from './icons.js';

/**
 * The disclosure chevron, taken from the host's icon set instead of drawn here.
 *
 * The host's own DisclosureRow primitive — the same affordance, used by the
 * conversation, cordis, tool and workflow surfaces — points a DOWN chevron while
 * the row is closed and an UP chevron while it is open, at the host icons'
 * default 14px. Drawn here, it was a 12px path with a 1.4px stroke: a geometry
 * no host surface uses, which reads as a foreign glyph next to the host's own.
 *
 * Kept in one place because the two panels had already drifted apart in
 * geometry once — exactly the failure a shared control prevents.
 */
export function chevronIcon(open: boolean): React.ReactElement {
  return open
    ? React.createElement(IconChevronUp, { size: 14 })
    : React.createElement(IconChevronDown, { size: 14 });
}

/**
 * The row's leading box, laid out exactly like the host's `DisclosureRow`: one
 * fixed 18px square holds BOTH the domain glyph and the disclosure chevron, and
 * hovering the row swaps the glyph out for the chevron in place. Two reasons to
 * copy that instead of adding a second box:
 *
 *  - no layout shift — the box never changes size, so nothing reflows on hover;
 *  - a list of rows reads as named capabilities rather than as a column of
 *    arrows, which is what an always-visible chevron per row produces.
 *
 * While the row is OPEN the host shows the chevron alone (its `leading` is the
 * up-chevron, not the glyph), so the same swap is mirrored here.
 */
function leadingBox(children: React.ReactNode): React.ReactElement {
  return React.createElement('span', { className: 'ci-leading', 'aria-hidden': true }, children);
}

function glyph(className: string, child: React.ReactNode, key?: string): React.ReactElement {
  return React.createElement('span', { className, 'aria-hidden': true, ...(key === undefined ? {} : { key }) }, child);
}

export interface DisclosureRowOptions {
  /** Stable identity for both the React key and the expanded-state map. */
  readonly rowKey: string;
  /** Whether this row's detail is currently expanded. */
  readonly expanded: boolean;
  /** A filter is active, so matching detail is forced open. */
  readonly filtering: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Accessible name for the trigger; the caller translates it. */
  readonly triggerLabel: string;
  readonly className: string;
  readonly headerClassName: string;
  /** Rendered inside the trigger, next to the chevron. */
  readonly heading: React.ReactNode;
  /**
   * The row's domain glyph — the host's own rows all carry one, and without it
   * a leading slot is nothing but a chevron. Omitted, the leading slot keeps a
   * plain always-visible chevron, which is what callers that have no glyph to
   * show (and the tests that pin that older shape) still get.
   */
  readonly icon?: React.ReactNode;
  /** Rendered after the trigger, outside it: switches, chips, buttons. */
  readonly actions: readonly React.ReactNode[];
  /** The revealed content. Absent means there is nothing to reveal. */
  readonly detail?: React.ReactNode;
  readonly style?: React.CSSProperties;
  /** Class for the placeholder that keeps a detail-less row aligned. */
  readonly spacerClassName?: string;
}

/** The leading slot for a row that has a domain glyph. */
function glyphLeading(icon: React.ReactNode, open: boolean): React.ReactElement {
  if (open) return leadingBox(glyph('ci-chevron', chevronIcon(true)));
  return leadingBox([
    glyph('ci-row-icon', icon, 'icon'),
    glyph('ci-chevron ci-chevron-hover', chevronIcon(false), 'chevron'),
  ]);
}

/** The leading slot for a row with no glyph: the chevron, as before. */
function chevronLeading(open: boolean): React.ReactElement {
  return React.createElement('span', { className: 'ci-chevron', 'aria-hidden': true }, chevronIcon(open));
}

/**
 * The leading slot of one expandable row.
 *
 * Exported so the panel's own row builder — which needs the same slot in a
 * different component tree — renders it from here instead of re-implementing
 * it. That is the drift this module exists to prevent: the two panels once
 * carried two different chevrons.
 */
export function leadingFor(icon: React.ReactNode | undefined, open: boolean): React.ReactElement {
  return icon === undefined ? chevronLeading(open) : glyphLeading(icon, open);
}

/** The leading slot of a row with nothing to reveal: the glyph alone. */
export function leadingStatic(icon: React.ReactNode): React.ReactElement {
  return leadingBox(glyph('ci-row-icon', icon));
}

/**
 * One capability row that may reveal detail.
 *
 * Both panels show the same kind of thing — a name, a switch, and detail worth
 * hiding until asked for — so both get the same affordance from one place. A
 * row with no detail renders no trigger at all rather than an empty one, and
 * takes a spacer so its name still lines up with the rows that do.
 */
export function disclosureRow(options: DisclosureRowOptions): React.ReactElement {
  const hasIcon = options.icon !== undefined;
  const hasDetail = options.detail !== undefined && options.detail !== null && options.detail !== '';
  if (!hasDetail) {
    return React.createElement(
      'div',
      { className: options.className, ...(options.style === undefined ? {} : { style: options.style }) },
      React.createElement(
        'div',
        { className: options.headerClassName },
        hasIcon
          ? leadingStatic(options.icon as React.ReactNode)
          : React.createElement('span', {
            'aria-hidden': true,
            ...(options.spacerClassName === undefined
              ? { style: { width: '18px', flex: 'none' } }
              : { className: options.spacerClassName }),
          }),
        options.heading,
        ...options.actions,
      ),
    );
  }
  const disclosure = resolveDisclosure(options.expanded, options.filtering);
  return React.createElement(
    Collapsible.Root,
    {
      open: disclosure.open,
      onOpenChange: options.onOpenChange,
      className: options.className,
      ...(options.style === undefined ? {} : { style: options.style }),
    },
    React.createElement(
      'div',
      { className: options.headerClassName },
      React.createElement(
        Collapsible.Trigger,
        {
          className: 'ci-disclosure-trigger',
          disabled: disclosure.disabled,
          'aria-label': options.triggerLabel,
        },
        hasIcon ? leadingFor(options.icon, disclosure.open) : chevronLeading(disclosure.open),
        options.heading,
      ),
      ...options.actions,
    ),
    React.createElement(Collapsible.Panel, { className: 'ci-collapse' }, options.detail),
  );
}