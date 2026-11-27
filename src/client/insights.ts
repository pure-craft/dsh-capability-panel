import * as React from 'react';
import { Tabs } from '@base-ui/react/tabs';
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives';
import type { InsightsPayload } from '../insights-contract.js';
import { parseInsightsPayload } from '../insights-wire.js';
import { getSnapshot, subscribe, refresh, setCapability } from './store.js';
import { capabilitySwitch } from './switch.js';
import { insightsText } from './insights-locale.js';
import { insightRows, insightBarPercent, insightsUrl } from './insights-model.js';
export { INSIGHTS_CSS } from './insights-styles.js';

export interface InsightsSectionProps {
  readonly sessionId?: string;
  readonly initialScope?: 'workspace' | 'global';
  readonly subscribeLocale: (listener: () => void) => () => void;
  readonly getLocaleSnapshot: () => { readonly active: string; readonly revision: number };
  readonly onEntryChange?: (visible: boolean) => void;
}

/** The same Menu and trigger geometry used by the preset settings picker. */
function Picker(props: { label: string; value: string; options: readonly { id: string; label: string }[]; onChange: (value: string) => void }): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  return React.createElement(Menu, {
    open,
    anchor: React.createElement('button', { type: 'button', className: 'ci-preset-picker-trigger', 'aria-label': props.label, 'aria-haspopup': 'menu', 'aria-expanded': open, onClick: () => { setOpen(!open); } }, props.options.find((option) => option.id === props.value)?.label ?? props.value),
    items: props.options,
    selectedId: props.value,
    onSelect: (id: string) => { props.onChange(id); setOpen(false); },
    onClose: () => { setOpen(false); },
  });
}

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export function InsightsSection(props: InsightsSectionProps): React.ReactElement {
  const h = React.createElement;
  const locale = React.useSyncExternalStore(props.subscribeLocale, props.getLocaleSnapshot, props.getLocaleSnapshot).active;
  const text = (key: string, params?: Record<string, string | number>) => insightsText(locale, key, params);
  const session = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [scope, setScope] = React.useState<'workspace' | 'global'>(props.initialScope ?? (props.sessionId === undefined ? 'global' : 'workspace'));
  const effectiveScope = props.sessionId === undefined ? 'global' : scope;
  const [preset, setPreset] = React.useState('');
  const [category, setCategory] = React.useState<'tools' | 'skills'>('tools');
  const [order, setOrder] = React.useState<'unused' | 'most'>('unused');
  const [payload, setPayload] = React.useState<InsightsPayload | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [revision, setRevision] = React.useState(0);
  const [entry, setEntry] = React.useState<boolean | null>(null);
  const [writing, setWriting] = React.useState(false);
  const [backfilling, setBackfilling] = React.useState(false);
  const [backfillNote, setBackfillNote] = React.useState<string | null>(null);
  const generation = React.useRef(0);
  const actionGeneration = React.useRef(0);
  React.useEffect(() => {
    actionGeneration.current += 1;
    setWriting(false); setBackfilling(false); setBackfillNote(null);
    return () => { actionGeneration.current += 1; };
  }, [props.sessionId, scope, preset]);

  React.useEffect(() => {
    const mine = ++generation.current;
    setLoading(true); setPayload(null); setError(null);
    void getJson(insightsUrl(props.sessionId, effectiveScope, preset)).then((value) => {
      const result = parseInsightsPayload(value);
      if (generation.current === mine) setPayload(result);
    }).catch((reason: unknown) => {
      if (generation.current === mine) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => { if (generation.current === mine) setLoading(false); });
    return () => { generation.current += 1; };
  }, [props.sessionId, effectiveScope, preset, revision]);

  React.useEffect(() => { if (props.sessionId !== undefined) void refresh(props.sessionId); }, [props.sessionId]);
  React.useEffect(() => {
    let active = true;
    void getJson('/api/capability-panel/insights/preferences').then((value) => {
      if (active && value !== null && typeof value === 'object' && 'insightsEntry' in value && typeof value.insightsEntry === 'boolean') setEntry(value.insightsEntry);
    }).catch((reason: unknown) => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, []);

  const writeEntry = (visible: boolean) => {
    const mine = actionGeneration.current;
    setWriting(true);
    void getJson('/api/capability-panel/insights/preferences', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ insightsEntry: visible }) }).then(() => {
      if (mine === actionGeneration.current) { setEntry(visible); props.onEntryChange?.(visible); }
    }).catch((reason: unknown) => { if (mine === actionGeneration.current) setError(String(reason)); }).finally(() => { if (mine === actionGeneration.current) setWriting(false); });
  };
  const backfill = () => {
    const mine = actionGeneration.current;
    setBackfilling(true); setError(null);
    void getJson(insightsUrl(props.sessionId, effectiveScope, preset).replace('/insights?', '/insights/backfill?'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((value) => {
      if (mine !== actionGeneration.current) return;
      if (value === null || typeof value !== 'object' || !('processedSessions' in value) || !('remainingSessions' in value) || typeof value.processedSessions !== 'number' || typeof value.remainingSessions !== 'number') throw new Error('Invalid backfill response');
      const warnings = 'warnings' in value && Array.isArray(value.warnings) ? value.warnings.filter((warning): warning is string => typeof warning === 'string') : [];
      setBackfillNote([text('backfillResult', { processed: value.processedSessions, remaining: value.remainingSessions }), ...warnings].join(' '));
      setRevision((previous) => previous + 1);
    }).catch((reason: unknown) => { if (mine === actionGeneration.current) setError(String(reason)); }).finally(() => { if (mine === actionGeneration.current) setBackfilling(false); });
  };

  // A preset-filtered result is not the current session's inventory. Do not
  // invent zero counts or expose session switches for that distinct population.
  const inventory = props.sessionId !== undefined && session.payload?.sessionId === props.sessionId && preset === '' ? session.payload : null;
  const rows = payload === null ? [] : insightRows(payload, inventory, category, order);
  const maximum = Math.max(0, ...rows.map((row) => row.count ?? 0));
  const presetOptions = [{ id: '', label: text('allPresets') }, ...(payload?.presets ?? []).filter((item) => item.presetId !== null).map((item) => ({ id: item.presetId!, label: item.presetId! }))];
  if (preset !== '' && !presetOptions.some((item) => item.id === preset)) presetOptions.push({ id: preset, label: preset });
  return h('section', { className: 'ci-preset-section', 'aria-label': text('title') },
    h('h2', { className: 'ci-settings-title' }, text('title')),
    h('p', { className: 'ci-settings-intro' }, text('intro')),
    h('div', { className: 'ci-insights-toolbar' }, h('span', { className: 'ci-insights-message' }, text('entry')), capabilitySwitch({ checked: entry === true, disabled: entry === null, busy: writing, label: text('entry'), onCheckedChange: writeEntry })),
    h('div', { className: 'ci-insights-controls' },
      h(Picker, { label: text('scope'), value: effectiveScope, options: props.sessionId === undefined ? [{ id: 'global', label: text('global') }] : [{ id: 'workspace', label: text('workspace') }, { id: 'global', label: text('global') }], onChange: (next: string) => { setScope(next as 'workspace' | 'global'); } }),
      h(Picker, { label: text('preset'), value: preset, options: presetOptions, onChange: setPreset }),
      h(Picker, { label: text('order'), value: order, options: [{ id: 'unused', label: text('unusedFirst') }, { id: 'most', label: text('mostUsed') }], onChange: (next: string) => { setOrder(next as 'unused' | 'most'); } }),
      h('button', { type: 'button', className: 'ci-preset-picker-trigger', disabled: loading, onClick: () => { setRevision((previous) => previous + 1); } }, text('refresh')),
      h('button', { type: 'button', className: 'ci-preset-picker-trigger', disabled: backfilling, onClick: backfill }, text('backfill'))),
    h(Tabs.Root, { value: category, onValueChange: (value: unknown) => { setCategory(value as 'tools' | 'skills'); } }, h(Tabs.List, { className: 'ci-tabs', 'aria-label': text('category') }, ...(['tools', 'skills'] as const).map((value) => h(Tabs.Tab, { key: value, value, className: 'ci-tab' }, text(value))))),
    h('p', { className: 'ci-settings-note' }, text(preset !== '' ? 'presetReadonly' : props.sessionId === undefined ? 'noSession' : 'sessionOnly')),
    h('p', { className: 'ci-insights-message' }, text('coverage')),
    payload !== null && (!payload.coverage.complete || payload.coverage.unknown) ? h('p', { className: 'ci-settings-note', role: 'status' }, text('insufficient')) : null,
    loading ? h('p', { className: 'ci-insights-message', role: 'status' }, text('loading')) : null,
    error !== null || session.error !== null ? h('p', { className: 'ci-insights-message ci-insights-error', role: 'alert' }, text('error'), ' ', error ?? session.error) : null,
    backfillNote === null ? null : h('p', { className: 'ci-insights-message', role: 'status' }, backfillNote),
    ...(payload?.warnings ?? []).map((warning, index) => h('p', { key: index, className: 'ci-insights-message', role: 'status' }, warning)),
    payload !== null && rows.length === 0 ? h('p', { className: 'ci-insights-message' }, text('empty')) : null,
    h('ul', { className: 'ci-insights-list' }, ...rows.map((row) => {
      const count = row.count === null ? text('unknown') : row.count === 0 ? text('unused') : text('count', { count: row.count });
      return h('li', { key: row.name, className: 'ci-row-head ci-insights-row' },
        h('div', { className: 'ci-insights-copy' }, h('span', { className: 'ci-insights-name', title: row.name }, row.label), row.count === null ? null : h('span', { className: 'ci-insights-meter', 'aria-hidden': true }, h('span', { className: 'ci-insights-meter-fill', style: { width: `${insightBarPercent(row.count, maximum)}%` } }))),
        h('span', { className: 'ci-insights-count', 'aria-label': text('rank', { name: row.label, count }) }, count),
        row.control === undefined || props.sessionId === undefined ? null : capabilitySwitch({ checked: row.control.enabled, disabled: row.control.reserved || loading, busy: session.loading, label: text(row.control.enabled ? 'disable' : 'enable', { name: row.label }), onCheckedChange: (enabled) => { void setCapability(props.sessionId!, row.control!.kind, row.name, enabled); } }));
    })));
}
