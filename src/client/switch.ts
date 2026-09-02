import * as React from 'react';
import { Switch } from '@base-ui/react/switch';
import { TOK } from './styles.js';

export interface CapabilitySwitchOptions {
  readonly checked: boolean;
  readonly disabled: boolean;
  /** Dim the control while a write is in flight. */
  readonly busy: boolean;
  /** Accessible name; the caller translates it. */
  readonly label: string;
  readonly onCheckedChange: (checked: boolean) => void;
}

/**
 * The capability switch, in one place for both panels.
 *
 * The two panels each had their own copy, and the copies had already drifted:
 * the thumb was a circle in one and a pill in the other, with different
 * transition durations and shadows. Nobody noticed, which is the point --
 * "how a control looks" belongs to the design system, while "what a row is
 * made of" belongs to each panel, so only the latter is written twice.
 */
export function capabilitySwitch(options: CapabilitySwitchOptions): React.ReactElement {
  const inert = options.disabled || options.busy;
  return React.createElement(
    Switch.Root,
    {
      className: 'ci-switch',
      checked: options.checked,
      disabled: inert,
      'aria-label': options.label,
      onCheckedChange: options.onCheckedChange,
      style: {
        position: 'relative',
        width: '32px',
        height: '18px',
        padding: 0,
        border: 'none',
        borderRadius: '999px',
        background: options.checked ? TOK.switchOn : TOK.switchOff,
        cursor: inert ? 'not-allowed' : 'pointer',
        opacity: options.busy ? 0.65 : 1,
        flex: '0 0 auto',
      },
    },
    React.createElement(Switch.Thumb, {
      className: 'ci-thumb',
      style: {
        display: 'block',
        width: '14px',
        height: '14px',
        margin: '2px',
        borderRadius: '999px',
        background: TOK.switchThumb,
        boxShadow: '0 1px 2px rgba(0,0,0,.22)',
        transform: options.checked ? 'translateX(14px)' : 'translateX(0)',
        transition: `transform .12s ${TOK.switchEase}`,
      },
    }),
  );
}
