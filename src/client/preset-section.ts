import * as React from 'react';
import { Collapsible } from '@base-ui/react/collapsible';
import { Input } from '@base-ui/react/input';
import { Tabs } from '@base-ui/react/tabs';
import { resolveDisclosure } from './disclosure.js';
import { chevronIcon, disclosureRow } from './disclosure-row.js';
import { capabilitySwitch } from './switch.js';
import { filterPreset } from './preset-filter.js';
import {
  getPresetToolsSnapshot,
  loadPresetTools,
  selectPreset,
  setPresetServer,
  setPresetSkill,
  setPresetTool,
  subscribePresetTools,
} from './preset-store.js';
import type { PresetSkillView, PresetToolView } from './preset-store.js';
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
export function PresetToolSection(props: PresetToolSectionProps): React.ReactElement {
  const { t } = props;
  const state = React.useSyncExternalStore(subscribePresetTools, getPresetToolsSnapshot);
  React.useSyncExternalStore(props.subscribeLocale, props.getLocaleSnapshot);
  React.useEffect(() => { void loadPresetTools(); }, []);
  const [query, setQuery] = React.useState('');
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  // Which categories to show. The composer panel switches between them with
  // exclusive tabs because it is a 360px popover; this panel is wide enough to
  // show all three at once, so "all" is the default and the tabs narrow it.
  const [kind, setKind] = React.useState<'all' | 'skills' | 'mcp' | 'system'>('all');

  const selected = state.payload?.presets.find((preset) => preset.id === state.selectedId);
  const filtering = query.trim() !== '';
  const view = selected === undefined ? null : filterPreset(selected, query);
  const writable = state.payload?.writable === true;
  const locked = state.loading || !writable;

  /** One switch, shared by tool rows, server rows and skill rows. */
  const switchFor = (
    on: boolean,
    frozen: boolean,
    label: string,
    onChange: (checked: boolean) => void,
  ): React.ReactElement =>
    capabilitySwitch({
      checked: on,
      disabled: locked || frozen,
      busy: state.loading,
      label,
      onCheckedChange: onChange,
    });

  const toggle = (tool: PresetToolView, presetId: string): React.ReactElement =>
    switchFor(
      tool.enabled,
      tool.reserved === true,
      tool.reserved === true
        ? t('preset.reserved', { name: tool.label })
        : t(tool.enabled ? 'action.disable' : 'action.enable', { name: tool.label }),
      (checked) => { void setPresetTool(presetId, tool.name, checked); },
    );

  /** Expand/collapse label, worded like the composer panel's. */
  const detailAria = (subject: string, rowKey: string): string => {
    const state = resolveDisclosure(expanded[rowKey] === true, filtering);
    const detail = t('detail.description');
    if (state.disabled) return t('disclosure.pinned', { subject, detail });
    return t(state.open ? 'disclosure.collapse' : 'disclosure.expand', { subject, detail });
  };

  const skillRow = (skill: PresetSkillView, presetId: string): React.ReactElement => {
    const rowKey = `skill:${skill.name}`;
    return React.createElement(
      'li',
      { key: rowKey, className: 'ci-preset-item' },
      disclosureRow({
        rowKey,
        expanded: expanded[rowKey] === true,
        filtering,
        onOpenChange: (open) => { setExpanded((prev) => ({ ...prev, [rowKey]: open })); },
        triggerLabel: detailAria(skill.name, rowKey),
        className: 'ci-preset-disclosure',
        headerClassName: 'ci-row-head ci-preset-tool-row',
        spacerClassName: 'ci-preset-spacer',
        heading: React.createElement(
          'span',
          { className: 'ci-preset-tool-name' },
          skill.name,
          // A project skill is real but conditional: it exists because THIS
          // workspace supplies it, and a session opened elsewhere will not see
          // it. Marking beats hiding, which would just look like a short list.
          skill.project === true
            ? React.createElement('span', { className: 'ci-preset-badge' }, t('preset.projectSkill'))
            : null,
        ),
        actions: [
          switchFor(
            skill.enabled,
            false,
            t(skill.enabled ? 'action.disable' : 'action.enable', { name: skill.name }),
            (checked) => { void setPresetSkill(presetId, skill.name, checked); },
          ),
        ],
        ...(skill.description === undefined
          ? {}
          : { detail: React.createElement('div', { className: 'ci-preset-detail' }, skill.description) }),
      }),
    );
  };

  const toolRow = (tool: PresetToolView, presetId: string, nested: boolean): React.ReactElement => {
    const rowKey = `tool:${tool.name}`;
    return React.createElement(
      'li',
      { key: tool.name, className: nested ? 'ci-toolrow ci-preset-item' : 'ci-preset-item' },
      disclosureRow({
        rowKey,
        expanded: expanded[rowKey] === true,
        filtering,
        onOpenChange: (open) => { setExpanded((prev) => ({ ...prev, [rowKey]: open })); },
        triggerLabel: detailAria(tool.label, rowKey),
        className: 'ci-preset-disclosure',
        headerClassName: 'ci-row-head ci-preset-tool-row',
        spacerClassName: 'ci-preset-spacer',
        heading: React.createElement('span', { className: 'ci-preset-tool-name' }, tool.label),
        actions: [toggle(tool, presetId)],
        ...(tool.description === undefined
          ? {}
          : { detail: React.createElement('div', { className: 'ci-preset-detail' }, tool.description) }),
      }),
    );
  };

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
    // The same three groups the composer panel uses, with the same labels and
    // the same shown/total counts. They are three because they are three
    // different things: skills and MCP servers both come from outside the
    // preset (the user's skills roots and the host composition), while system
    // tools are what the preset itself carries.
    const totals = {
      skills: selected.skills.length,
      mcp: selected.mcp.length,
      systemTools: selected.systemTools.length,
    };
    const groups: React.ReactElement[] = [];
    const group = (
      key: 'skills' | 'mcp' | 'system',
      label: string,
      rows: readonly React.ReactElement[],
    ): void => {
      if (kind !== 'all' && kind !== key) return;
      if (rows.length === 0) return;
      groups.push(React.createElement(
        'section',
        { key, className: 'ci-preset-part' },
        React.createElement('h3', { className: 'ci-preset-part-title' }, label),
        React.createElement('ul', { className: 'ci-preset-tool-list' }, ...rows),
      ));
    };

    group(
      'skills',
      t('group.skills', { shown: view.skills.length, total: totals.skills }),
      view.skills.map((skill) => skillRow(skill, selected.id)),
    );

    const serverRows = view.mcp.map((server) => {
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
            switchFor(
              server.enabled,
              false,
              t(server.enabled ? 'action.disable' : 'action.enable', { name: server.server }),
              (checked) => { void setPresetServer(selected.id, server.server, checked); },
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
    });

    group('mcp', t('group.mcp', { shown: view.mcp.length, total: totals.mcp }), serverRows);
    group(
      'system',
      t('group.system', { shown: view.systemTools.length, total: totals.systemTools }),
      view.systemTools.map((tool) => toolRow(tool, selected.id, false)),
    );
    // Narrowing to a category that this preset has nothing in is a normal
    // outcome, not an error: say so rather than render an empty panel.
    if (groups.length === 0) {
      return React.createElement('p', null, filtering ? t('empty.match') : t('preset.noTools'));
    }
    return React.createElement(React.Fragment, null, ...groups);
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
          // Same three categories, same words, as the composer panel's tabs --
          // plus "all", because this panel is wide enough to show every group
          // at once and that is the useful default here.
          selected === undefined
            ? null
            : React.createElement(
                Tabs.Root,
                {
                  value: kind,
                  onValueChange: (value: string) => { setKind(value as 'all' | 'skills' | 'mcp' | 'system'); },
                  className: 'ci-preset-kinds',
                },
                React.createElement(
                  Tabs.List,
                  { 'aria-label': t('preset.kindAria'), className: 'ci-tabs' },
                  React.createElement(Tabs.Tab, { value: 'all', className: 'ci-tab' }, t('tab.all')),
                  React.createElement(Tabs.Tab, { value: 'skills', className: 'ci-tab' }, `${t('tab.skills')} ${selected.skills.length}`),
                  React.createElement(Tabs.Tab, { value: 'mcp', className: 'ci-tab' }, `${t('tab.mcp')} ${selected.mcp.length}`),
                  React.createElement(
                    Tabs.Tab,
                    { value: 'system', className: 'ci-tab', 'aria-label': t('tab.system.aria', { count: selected.systemTools.length }) },
                    `${t('tab.system')} ${selected.systemTools.length}`,
                  ),
                ),
              ),
          selected?.description === undefined
            ? null
            : React.createElement('p', { className: 'ci-settings-description' }, selected.description),
          view === null || !filtering
            ? null
            : React.createElement(
                'p',
                { 'aria-live': 'polite', className: 'ci-settings-description' },
                t('filter.count', { shown: view.total, total: selected === undefined ? 0 : selected.skills.length + selected.mcp.length + selected.systemTools.length }),
              ),
          body(),
        ),
  );
}
