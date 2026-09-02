import * as React from 'react';
import { Collapsible } from '@base-ui/react/collapsible';
import { resolveDisclosure } from './disclosure.js';

/**
 * The chevron both panels use. Kept here rather than copied into each panel:
 * the two had already drifted apart in geometry once, which is exactly the
 * failure a shared control prevents.
 */
export const chevronIcon = React.createElement(
  'svg',
  { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
  React.createElement('path', {
    d: 'M6 3.5 10.5 8 6 12.5',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }),
);

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
  /** Rendered after the trigger, outside it: switches, chips, buttons. */
  readonly actions: readonly React.ReactNode[];
  /** The revealed content. Absent means there is nothing to reveal. */
  readonly detail?: React.ReactNode;
  readonly style?: React.CSSProperties;
  /** Class for the placeholder that keeps a detail-less row aligned. */
  readonly spacerClassName?: string;
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
  const hasDetail = options.detail !== undefined && options.detail !== null && options.detail !== '';
  if (!hasDetail) {
    return React.createElement(
      'div',
      { className: options.className, ...(options.style === undefined ? {} : { style: options.style }) },
      React.createElement(
        'div',
        { className: options.headerClassName },
        React.createElement('span', {
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
        React.createElement('span', { className: 'ci-chevron', 'aria-hidden': true }, chevronIcon),
        options.heading,
      ),
      ...options.actions,
    ),
    React.createElement(Collapsible.Panel, { className: 'ci-collapse' }, options.detail),
  );
}
