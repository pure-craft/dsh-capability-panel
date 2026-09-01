import * as React from 'react';
import { Collapsible } from '@base-ui/react/collapsible';
import { Input } from '@base-ui/react/input';
import { Switch } from '@base-ui/react/switch';
import { resolveDisclosure } from './disclosure.js';
import { filterPreset } from './preset-filter.js';
import {
  getPresetToolsSnapshot,
  loadPresetTools,
  selectPreset,
  setPresetServer,
  setPresetTool,
  subscribePresetTools,
} from './preset-store.js';
import type { PresetToolView } from './preset-store.js';
import type { Translate } from './locale.js';
import { TOK } from './styles.js';

export interface PresetToolSectionProps {
  readonly t: Translate;
  readonly subscribeLocale: (listener: () => void) => () => void;
  readonly getLocaleSnapshot: () => { readonly active: string; readonly revision: number };
}

/**
 * Settings-side twin of the composer panel. It reuses that panel's vocabulary
 * and interaction — an always-visible filter, MCP tools collapsed under their
 * server, one switch per row — because at ~200 tools a flat list is not
 * usable, and because two scopes of one feature should not feel like two
 * unrelated features.
 */
/** Same chevron the composer panel uses; CSS rotates it when expanded. */
const chevronIcon = React.createElement(
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

export function PresetToolSection(props: PresetToolSectionProps): React.ReactElement {
  const { t } = props;
  const state = React.useSyncExternalStore(subscribePresetTools, getPresetToolsSnapshot);
  React.useSyncExternalStore(props.subscribeLocale, props.getLocaleSnapshot);
  React.useEffect(() => { void loadPresetTools(); }, []);
  const [query, setQuery] = React.useState('');
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  const selected = state.payload?.presets.find((preset) => preset.id === state.selectedId);
  const filtering = query.trim() !== '';
  const view = selected === undefined ? null : filterPreset(selected, query);
  const writable = state.payload?.writable === true;
  const locked = state.loading || !writable;

  const toggle = (tool: PresetToolView, presetId: string): React.ReactElement =>
    React.createElement(
      Switch.Root,
      {
        checked: tool.enabled,
        disabled: locked || tool.reserved === true,
        onCheckedChange: (checked: boolean) => { void setPresetTool(presetId, tool.name, checked); },
        className: 'ci-switch',
        style: {
          position: 'relative', width: '32px', height: '18px', padding: 0, border: 'none',
          borderRadius: '999px', background: tool.enabled ? TOK.switchOn : TOK.switchOff,
          cursor: locked || tool.reserved === true ? 'not-allowed' : 'pointer',
          opacity: state.loading ? 0.65 : 1, flex: '0 0 auto',
        },
        'aria-label': tool.reserved === true
          ? t('preset.reserved', { name: tool.label })
          : t(tool.enabled ? 'action.disable' : 'action.enable', { name: tool.label }),
      },
      React.createElement(Switch.Thumb, {
        className: 'ci-thumb',
        style: {
          display: 'block', width: '14px', height: '14px', margin: '2px', borderRadius: '50%',
          background: TOK.switchThumb, transform: tool.enabled ? 'translateX(14px)' : 'translateX(0)',
          transition: `transform .14s ${TOK.switchEase}`, boxShadow: '0 1px 2px rgba(0,0,0,.2)',
        },
      }),
    );

  const toolRow = (tool: PresetToolView, presetId: string, nested: boolean): React.ReactElement =>
    React.createElement(
      'li',
      { key: tool.name, className: nested ? 'ci-toolrow ci-preset-tool-row' : 'ci-preset-tool-row' },
      React.createElement(
        'div',
        { className: 'ci-preset-tool-copy' },
        React.createElement('span', { className: 'ci-preset-tool-name' }, tool.label),
        tool.description === undefined
          ? null
          : React.createElement('span', { className: 'ci-preset-tool-description' }, tool.description),
      ),
      toggle(tool, presetId),
    );

  const body = (): React.ReactElement | null => {
    if (selected === undefined || view === null) return React.createElement('p', null, t('preset.empty'));
    if (selected.broken !== undefined) {
      return React.createElement(
        'p',
        { role: 'alert', className: 'ci-settings-note', style: { color: TOK.error } },
        t('preset.broken', { reason: selected.broken }),
      );
    }
    if (view.total === 0) {
      return React.createElement('p', null, filtering ? t('empty.match') : t('preset.noTools'));
    }
    return React.createElement(
      'ul',
      { className: 'ci-preset-tool-list' },
      ...view.mcp.map((server) => {
        const key = `mcp:${server.server}`;
        const disclosure = resolveDisclosure(expanded[key] === true, filtering);
        return React.createElement(
          'li',
          { key, className: 'ci-preset-group' },
          React.createElement(
            Collapsible.Root,
            {
              open: disclosure.open,
              onOpenChange: (open: boolean) => { setExpanded((prev) => ({ ...prev, [key]: open })); },
            },
            React.createElement(
              'div',
              { className: 'ci-row-head ci-preset-tool-row' },
              React.createElement(
                Collapsible.Trigger,
                {
                  className: 'ci-disclosure-trigger ci-preset-server-trigger',
                  disabled: disclosure.disabled,
                },
                React.createElement('span', { className: 'ci-chevron', 'aria-hidden': true }, chevronIcon),
                React.createElement(
                  'span',
                  { className: 'ci-preset-tool-copy' },
                  React.createElement('span', { className: 'ci-preset-tool-name' }, server.server),
                  React.createElement(
                    'span',
                    { className: 'ci-preset-tool-description' },
                    t('server.tools', { count: server.tools.length }),
                  ),
                ),
              ),
              // One write for the whole server: the reason a 200-tool preset is
              // tractable at all.
              React.createElement(
                Switch.Root,
                {
                  checked: server.enabled,
                  disabled: locked,
                  onCheckedChange: (checked: boolean) => { void setPresetServer(selected.id, server.server, checked); },
                  className: 'ci-switch',
                  style: {
                    position: 'relative', width: '32px', height: '18px', padding: 0, border: 'none',
                    borderRadius: '999px', background: server.enabled ? TOK.switchOn : TOK.switchOff,
                    cursor: locked ? 'not-allowed' : 'pointer',
                    opacity: state.loading ? 0.65 : 1, flex: '0 0 auto',
                  },
                  'aria-label': t(server.enabled ? 'action.disable' : 'action.enable', { name: server.server }),
                },
                React.createElement(Switch.Thumb, {
                  className: 'ci-thumb',
                  style: {
                    display: 'block', width: '14px', height: '14px', margin: '2px', borderRadius: '50%',
                    background: TOK.switchThumb, transform: server.enabled ? 'translateX(14px)' : 'translateX(0)',
                    transition: `transform .14s ${TOK.switchEase}`, boxShadow: '0 1px 2px rgba(0,0,0,.2)',
                  },
                }),
              ),
            ),
            React.createElement(
              Collapsible.Panel,
              { className: 'ci-collapse' },
              React.createElement(
                'ul',
                { className: 'ci-preset-tool-list' },
                ...server.tools.map((tool) => toolRow(tool, selected.id, true)),
              ),
            ),
          ),
        );
      }),
      ...view.systemTools.map((tool) => toolRow(tool, selected.id, false)),
    );
  };

  return React.createElement(
    'div',
    { className: 'ci-preset-section' },
    React.createElement('h2', { className: 'ci-settings-title' }, t('preset.title')),
    React.createElement('p', { className: 'ci-settings-intro' }, t('preset.intro')),
    state.error === null
      ? null
      : React.createElement('p', { role: 'alert', style: { color: TOK.error } }, t('status.error', { error: state.error })),
    state.loading && state.payload === null
      ? React.createElement('p', { 'aria-live': 'polite', style: { color: TOK.textTertiary } }, t('status.loading'))
      : null,
    state.payload === null
      ? null
      : React.createElement(
          React.Fragment,
          null,
          writable
            ? null
            : React.createElement('p', { role: 'note', className: 'ci-settings-note' }, t('preset.readonly')),
          React.createElement(
            'div',
            { className: 'ci-preset-toolbar' },
            React.createElement(
              'label',
              { className: 'ci-preset-picker-label' },
              React.createElement('span', null, t('preset.choose')),
              React.createElement(
                'select',
                {
                  className: 'ci-preset-picker',
                  value: state.selectedId ?? '',
                  onChange: (event: React.ChangeEvent<HTMLSelectElement>) => { selectPreset(event.target.value); },
                },
                ...state.payload.presets.map((preset) => React.createElement('option', { key: preset.id, value: preset.id }, preset.name)),
              ),
            ),
            React.createElement(Input, {
              className: 'ci-filter ci-preset-filter',
              value: query,
              placeholder: t('filter.placeholder'),
              'aria-label': t('filter.aria'),
              autoComplete: 'off',
              spellCheck: false,
              name: 'ci-preset-filter',
              onChange: (event: { target: { value: string } }) => { setQuery(event.target.value); },
              onKeyDown: (event: { key: string }) => { if (event.key === 'Escape' && filtering) setQuery(''); },
            }),
          ),
          selected?.description === undefined
            ? null
            : React.createElement('p', { className: 'ci-settings-description' }, selected.description),
          view === null || !filtering
            ? null
            : React.createElement(
                'p',
                { 'aria-live': 'polite', className: 'ci-settings-description' },
                t('filter.count', { shown: view.total, total: selected === undefined ? 0 : selected.mcp.length + selected.systemTools.length }),
              ),
          body(),
        ),
  );
}
