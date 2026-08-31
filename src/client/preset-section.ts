import * as React from 'react';
import { Switch } from '@base-ui/react/switch';
import { getPresetToolsSnapshot, loadPresetTools, selectPreset, setPresetTool, subscribePresetTools } from './preset-store.js';
import type { Translate } from './locale.js';
import { TOK } from './styles.js';

export interface PresetToolSectionProps {
  readonly t: Translate;
  readonly subscribeLocale: (listener: () => void) => () => void;
  readonly getLocaleSnapshot: () => { readonly active: string; readonly revision: number };
}

export function PresetToolSection(props: PresetToolSectionProps): React.ReactElement {
  const { t } = props;
  const state = React.useSyncExternalStore(subscribePresetTools, getPresetToolsSnapshot);
  React.useSyncExternalStore(props.subscribeLocale, props.getLocaleSnapshot);
  React.useEffect(() => { void loadPresetTools(); }, []);
  const selected = state.payload?.presets.find((preset) => preset.id === state.selectedId);

  return React.createElement(
    'div',
    { className: 'ci-preset-section' },
    React.createElement('h2', { className: 'ci-settings-title' }, t('preset.title')),
    React.createElement('p', { className: 'ci-settings-intro' }, t('preset.intro')),
    state.error === null ? null : React.createElement('p', { role: 'alert', style: { color: TOK.error } }, t('status.error', { error: state.error })),
    state.loading && state.payload === null
      ? React.createElement('p', { 'aria-live': 'polite', style: { color: TOK.textTertiary } }, t('status.loading'))
      : null,
    state.payload === null
      ? null
      : React.createElement(
          React.Fragment,
          null,
          state.payload.writable
            ? null
            : React.createElement('p', { role: 'note', className: 'ci-settings-note' }, t('preset.readonly')),
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
          selected === undefined
            ? React.createElement('p', null, t('preset.empty'))
            : React.createElement(
                'section',
                { 'aria-labelledby': 'ci-preset-tools-heading' },
                React.createElement('h3', { id: 'ci-preset-tools-heading', className: 'ci-settings-subtitle' }, t('preset.tools', { count: selected.tools.length })),
                selected.description === undefined ? null : React.createElement('p', { className: 'ci-settings-description' }, selected.description),
                selected.broken === undefined
                  ? null
                  : React.createElement('p', { role: 'alert', className: 'ci-settings-note', style: { color: TOK.error } }, t('preset.broken', { reason: selected.broken })),
                selected.tools.length === 0
                  ? React.createElement('p', null, t('preset.noTools'))
                  : React.createElement(
                      'ul',
                      { className: 'ci-preset-tool-list' },
                      ...selected.tools.map((tool) => React.createElement(
                        'li',
                        { key: tool.name, className: 'ci-preset-tool-row' },
                        React.createElement(
                          'div',
                          { className: 'ci-preset-tool-copy' },
                          React.createElement('span', { className: 'ci-preset-tool-name' }, tool.name),
                          tool.description === undefined ? null : React.createElement('span', { className: 'ci-preset-tool-description' }, tool.description),
                        ),
                        React.createElement(
                          Switch.Root,
                          {
                            checked: tool.enabled,
                            disabled: state.loading || !state.payload?.writable || tool.reserved === true,
                            onCheckedChange: (checked: boolean) => { void setPresetTool(selected.id, tool.name, checked); },
                            className: 'ci-switch',
                            style: {
                              position: 'relative', width: '32px', height: '18px', padding: 0, border: 'none',
                              borderRadius: '999px', background: tool.enabled ? TOK.switchOn : TOK.switchOff,
                              cursor: state.loading || !state.payload?.writable || tool.reserved === true ? 'not-allowed' : 'pointer',
                              opacity: state.loading ? 0.65 : 1, flex: '0 0 auto',
                            },
                            'aria-label': tool.reserved === true
                              ? t('preset.reserved', { name: tool.name })
                              : t(tool.enabled ? 'action.disable' : 'action.enable', { name: tool.name }),
                          },
                          React.createElement(Switch.Thumb, {
                            className: 'ci-thumb',
                            style: {
                              display: 'block', width: '14px', height: '14px', margin: '2px', borderRadius: '50%',
                              background: TOK.switchThumb, transform: tool.enabled ? 'translateX(14px)' : 'translateX(0)',
                              transition: `transform .14s ${TOK.switchEase}`, boxShadow: '0 1px 2px rgba(0,0,0,.2)',
                            },
                          }),
                        ),
                      )),
                    ),
              ),
        ),
  );
}
