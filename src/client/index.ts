/**
 * Browser half: a toolbar button in the composer trailing row, and the panel
 * it opens. The trigger keeps ContextMeter's chrome (28×28 ghost button,
 * pill radius, hover wash, 14px layers glyph, Tooltip 200ms); the panel
 * itself is a Base UI Popover with enter/exit animation and proper focus
 * management, anchored `side=top align=end` to the trigger.
 *
 * Component strategy: interactive behavior comes from @base-ui/react —
 * Switch for toggles, Collapsible for disclosures,
 * Tabs for the three capability sections, Popover for the shell, Input for
 * the always-visible filter. We write only token skins. Base UI is bundled per-plugin (Plan A):
 * it is a devDependency because tsdown auto-externalizes `dependencies`, and
 * the browser has no node_modules to resolve a leaked require.
 *
 * Information architecture: three sections become tabs (a 320px-wide stacked
 * list forced scrolling past whole sections to reach the next). While the
 * filter query is active the tabs collapse into one flat, fully-expanded
 * result list — a match can come from a description, so hidden detail would
 * make "why did this row match" unanswerable.
 *
 * Colors/typography come from the host's `--dsw-*` design tokens with hex
 * fallbacks so the panel never renders unstyled while a token is absent;
 * chips tint via color-mix on the same tokens, so dark mode stays free.
 */
import type { McpServerEntry, SkillEntry, SkillLoadState, ToolEntry } from '../contract.js';
import { subscribe, getSnapshot, toggle, close, refresh, reset, setCapability } from './store.js';
import { filterPayload } from './filter.js';
import { MCP_TOOL_ROOT_CLASS, ROW_HEADER_CLASS, ROW_ROOT_CLASS, resolveDisclosure } from './disclosure.js';
import { LOCALE_NS, registerLocale } from './locale.js';
import type { LocaleService } from './locale.js';
import { PANEL_CSS, TOK } from './styles.js';
import { capabilitySwitch } from './switch.js';
import { PresetToolSection } from './preset-section.js';
import { resetPresetTools } from './preset-store.js';

// React comes through the module loader's `require`, which resolves the HOST's
// copy — the runtime calls `apply(ctx, config)`, never `apply(ctx, react)`.
// tsdown keeps this import external so no second React instance is bundled.
import * as React from 'react';
// Same story for primitives: the module system resolves it to the host graph's
// row (every shipped UI bundle requires it the same way), keeping Tooltip's
// theme and i18n context singular. tsdown must NOT bundle it.
import {
  IconChevronRightOutline14,
  IconContextInjectionOutline16,
  IconSendOutline14,
  IconSearchOutline16,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives';
// Base UI's `react`/`react/jsx-runtime` imports stay external and resolve to
// the host instance, exactly like our own (verified against shipped bundles).
import { Collapsible } from '@base-ui/react/collapsible';
import { Input } from '@base-ui/react/input';
import { Popover } from '@base-ui/react/popover';
import { Tabs } from '@base-ui/react/tabs';

interface SlotContext {
  readonly slots: {
    inject(name: string, callback: () => (() => void) | void): void;
    register(spec: Record<string, unknown>, component: unknown): () => void;
  };
  /** Cordis lifecycle/event verb, on the dynamic facade's whitelist. */
  on(event: 'connection/reset', listener: () => void): void;
  effect(factory: () => (() => void) | void, label?: string): void;
  /**
   * The host's locale runtime (dsh-client-locale), a hard inject like every
   * shipped UI bundle: dictionaries register into it, and its revision
   * observable re-renders the panel on a language switch.
   */
  readonly locale: LocaleService;
}

interface DockProps {
  readonly sessionId?: string;
  /** InputZone owner prop: the live input snapshot (we only read the draft). */
  readonly input?: { readonly draft?: string };
  /**
   * Standard prop published by ui-conversation's input kit. The panel only
   * fills the draft — submitting stays with the user (Enter / send button).
   */
  readonly inputActions?: {
    setDraft(text: string): void;
  };
}

/** The host's React, typed loosely because its identity must stay the host's. */
type ReactLike = {
  createElement(this: void, type: unknown, props?: unknown, ...children: unknown[]): unknown;
  useState<T>(initial: T): [T, (next: T | ((prev: T) => T)) => void];
  useRef<T>(initial: T): { current: T };
  useSyncExternalStore<T>(subscribe: (cb: () => void) => () => void, get: () => T): T;
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
};

/**
 * Order by how much the reader needs to act on it: what fell out of context
 * first, then what is in it, then the rest.
 */
const STATE_ORDER: Record<SkillLoadState, number> = { evicted: 0, pruned: 1, loaded: 2, unloaded: 3 };

function sortSkills(skills: readonly SkillEntry[]): SkillEntry[] {
  return [...skills].sort(
    (a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.name.localeCompare(b.name),
  );
}

export function apply(ctx: SlotContext): void {
  const react = React as unknown as ReactLike;
  const h = react.createElement;

  // Panel copy follows the host's language switch: dictionaries register into
  // the shared locale runtime, and `t` reads the active locale per call.
  ctx.effect(() => registerLocale(ctx.locale), 'capability-panel: dictionaries');
  const t = ctx.locale.bind(LOCALE_NS);
  // uSES channel over the locale revision: a language switch re-renders the
  // panel even though `t` itself is a stable reference.
  const subscribeLocale = (fn: () => void): (() => void) => ctx.locale.subscribe(fn);
  const getLocaleSnapshot = (): { readonly active: string; readonly revision: number } => ctx.locale.getSnapshot();

  // A host restart drops every fact the panel shows; ui-skill clears its
  // caches on the same event. The store's reset also invalidates in-flight
  // answers from the dead connection.
  ctx.on('connection/reset', () => {
    reset();
    resetPresetTools();
  });

  // Pseudo-class states can't be expressed inline: one small stylesheet for
  // hover, focus-visible, enter/exit animation, the tabs skin, collapsible
  // height animation, and row-level content-visibility. Colors stay on the
  // same --dsw-* tokens the inline styles use. Lifecycle follows the
  // workspace rule: ctx.effect + data-plugin tag, so HMR/unload removes it
  // and a fresh apply can update the content.
  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {};
    const style = document.createElement('style');
    style.dataset.plugin = 'dsh-capability-panel';
    style.textContent = PANEL_CSS;
    document.head.appendChild(style);
    return () => { style.remove(); };
  }, 'capability-panel: stylesheet');

  /** Host iconography: the panel inspects what lands in the session's context. */
  const layersIcon = (size: number) => h(IconContextInjectionOutline16, { size });

  /** Magnifier sitting inside the filter input. */
  const searchIcon = (size: number) => h(IconSearchOutline16, { size });

  /** Paper plane: the row action lands the command in the composer,
   *  ready for the user's own Enter. */
  const insertIcon = (size: number) => h(IconSendOutline14, { size });

  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      { name: 'settings.section', id: 'capability-panel', order: 25, label: () => t('preset.nav') },
      () => h(PresetToolSection, { t, subscribeLocale, getLocaleSnapshot }),
    ),
  );

  ctx.slots.inject('conversation.input.right', () =>
    ctx.slots.register({ name: 'conversation.input.right', id: 'capability-panel', order: 1000 }, (props: DockProps) => {
      const snap = react.useSyncExternalStore(subscribe, getSnapshot);
      // Subscribed for the re-render, not the value: `t` reads the active
      // locale at call time, so a revision bump is all the panel needs.
      react.useSyncExternalStore(subscribeLocale, getLocaleSnapshot);
      // Per-row detail expansion, keyed so a reordered list keeps each row's
      // state. While a filter query is active every visible row is forced
      // open so the text it matched on shows without a second click.
      const [expanded, setExpanded] = react.useState<Record<string, boolean>>({});
      const [query, setQuery] = react.useState('');
      const [tab, setTab] = react.useState('skills');
      const sessionId = props.sessionId ?? null;

      // Refetch when the panel opens rather than polling: the answer is only
      // interesting while someone is looking at it.
      react.useEffect(() => {
        if (snap.open) void refresh(sessionId);
      }, [snap.open, sessionId]);

      // The store owns the open flag (it outlives this component); the
      // Popover is controlled by it and reports its own dismissal intents
      // (outside press, Escape) back through this sync.
      const syncOpen = (open: boolean) => {
        const current = getSnapshot().open;
        if (open && !current) toggle();
        else if (!open && current) close();
      };

      // One canonical query drives matching, clear affordance, Escape, and the
      // filtered layout. The old split (`trim()` here, raw query elsewhere)
      // made a spaces-only value look simultaneously filtered and unfiltered.
      const normalizedQuery = query.trim();
      const filtering = normalizedQuery !== '';
      const payload = snap.payload;
      const view = payload === null ? null : filterPayload(payload, normalizedQuery, (skill) => t(`state.${skill.state}`));
      const skills = view === null ? [] : sortSkills(view.skills);
      const mcp = view?.mcp ?? [];
      const systemTools = view?.systemTools ?? [];
      const blocked = payload?.blocked ?? {};
      const totals = {
        skills: payload?.skills.length ?? 0,
        mcp: payload?.mcp.length ?? 0,
        systemTools: payload?.systemTools.length ?? 0,
      };
      const totalAll = totals.skills + totals.mcp + totals.systemTools;

      const setOpen = (key: string, open: boolean) => {
        setExpanded((prev) => ({ ...prev, [key]: open }));
      };

      /**
       * Stable pill geometry for every skill state: green means loaded, blue
       * means pruned (head/tail still visible), neutral means unloaded, amber
       * means evicted, and the independent red pill records blocked attempts
       * after a capability was disabled.
       */
      const chip = (text: string, color: string) =>
        h(
          'span',
          {
            style: {
              flex: '0 0 auto',
              fontSize: '11px',
              lineHeight: '16px',
              padding: '1px 7px',
              borderRadius: '999px',
              color,
              background: `color-mix(in srgb, ${color} 14%, transparent)`,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            },
          },
          text,
        );

      // A blocked attempt is the strongest signal a toggle gives: the agent
      // still reached for the capability after the user turned it off.
      const blockedChip = (count: number) => (count > 0 ? chip(t('blocked.count', { count }), TOK.error) : null);

      const metaText = (text: string) =>
        h(
          'span',
          {
            style: {
              flex: '0 0 auto',
              fontSize: '11px',
              color: TOK.textTertiary,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            },
          },
          text,
        );

      // Skill state always occupies the same pill-shaped visual slot. Color,
      // not geometry, communicates meaning: loaded is green, pruned is the
      // informational blue of a partially visible result, unloaded stays
      // neutral, and evicted is amber because it may need attention.
      const stateMeta = (skill: SkillEntry) => {
        const text = t(`state.${skill.state}`) + (skill.loadCount > 1 ? ` ×${skill.loadCount}` : '');
        const color =
          skill.state === 'loaded'
            ? TOK.success
            : skill.state === 'pruned'
              ? TOK.info
              : skill.state === 'evicted'
                ? TOK.warn
                : TOK.textTertiary;
        return chip(text, color);
      };

      // Base UI Switch renders the button with role/aria-checked wired; we
      // keep the track sizing and token colors.
      const switchControl = (kind: 'skill' | 'mcp-server' | 'mcp-tool' | 'system-tool', name: string, enabled: boolean) =>
        capabilitySwitch({
          checked: enabled,
          disabled: sessionId === null,
          busy: snap.loading,
          label: t(enabled ? 'action.disable' : 'action.enable', { name }),
          onCheckedChange: (checked) => {
            if (sessionId !== null) void setCapability(sessionId, kind, name, checked);
          },
        });

      /** Right chevron the disclosure CSS rotates 90° when expanded. */
      const chevronIcon = h(IconChevronRightOutline14, { size: 12 });

      const groupLabel = (text: string, first: boolean) =>
        h(
          'div',
          {
            key: `group:${text}`,
            style: {
              fontWeight: 500,
              color: TOK.textTertiary,
              fontVariantNumeric: 'tabular-nums',
              margin: first ? '0 0 2px' : '12px 0 2px',
            },
          },
          text,
        );

      const nameText = (text: string) =>
        h(
          'span',
          {
            className: 'ci-name',
            style: {
              flex: '1 1 auto',
              wordBreak: 'break-all',
              color: TOK.textPrimary,
              fontWeight: 500,
            },
          },
          text,
        );

      /** The trigger's accessible name, localized with its subject. */
      const disclosureAria = (
        subject: string,
        detailKey: 'detail.description' | 'detail.tools',
        disclosure: { open: boolean; disabled: boolean },
      ) => {
        const detail = t(detailKey);
        if (disclosure.disabled) return t('disclosure.pinned', { subject, detail });
        return disclosure.open
          ? t('disclosure.collapse', { subject, detail })
          : t('disclosure.expand', { subject, detail });
      };

      /**
       * Shared disclosure row for Skills, MCP tools, and System tools. The
       * trigger owns only chevron + label; trailing actions remain independent
       * buttons and never toggle the description.
       */
      const disclosureRow = (
        key: string,
        enabled: boolean,
        label: string,
        description: string | undefined,
        actions: readonly unknown[],
        className = ROW_ROOT_CLASS,
      ) => {
        const hasDescription = description !== undefined && description !== '';
        const disclosure = resolveDisclosure(expanded[key] === true, filtering);
        const ariaLabel = disclosureAria(label, 'detail.description', disclosure);
        if (!hasDescription) {
          return h(
            'div',
            {
              key,
              className,
              style: { opacity: enabled ? 1 : 0.55 },
            },
            h(
              'div',
              { className: ROW_HEADER_CLASS },
              h('span', { style: { width: '18px', flex: 'none' } }),
              nameText(label),
              ...actions,
            ),
          );
        }
        return h(
          Collapsible.Root,
          {
            key,
            open: disclosure.open,
            onOpenChange: (open: boolean) => { setOpen(key, open); },
            className,
            style: { opacity: enabled ? 1 : 0.55 },
          },
          h(
            'div',
            { className: ROW_HEADER_CLASS },
            h(
              Collapsible.Trigger,
              {
                className: 'ci-disclosure-trigger',
                disabled: disclosure.disabled,
                'aria-label': ariaLabel,
              },
              h('span', { className: 'ci-chevron', 'aria-hidden': true }, chevronIcon),
              nameText(label),
            ),
            ...actions,
          ),
          h(
            Collapsible.Panel,
            { className: 'ci-collapse' },
            h('div', { className: 'ci-description' }, description),
          ),
        );
      };

      /**
       * Put a skill's slash command into the composer — never auto-submit:
       * whether to send is the user's call (Enter). A non-empty draft is
       * appended to, never replaced. Works for disabled skills too: the
       * disable shadow keeps userInvocable: true by design.
       */
      const insertCommand = (name: string) => {
        const actions = props.inputActions;
        if (actions === undefined) return;
        const draft = props.input?.draft ?? '';
        actions.setDraft(draft.trim() === '' ? `/${name} ` : `${draft} /${name} `);
        close();
      };

      const insertButton = (name: string) =>
        h(
          'button',
          {
            type: 'button',
            className: 'ci-iconbtn ci-send',
            'aria-label': t('action.insert', { name }),
            disabled: props.inputActions === undefined,
            onClick: () => { insertCommand(name); },
            style: {
              display: 'grid',
              placeItems: 'center',
              width: '20px',
              height: '20px',
              padding: 0,
              border: 'none',
              borderRadius: '999px',
              background: 'transparent',
              color: TOK.textTertiary,
              cursor: props.inputActions === undefined ? 'not-allowed' : 'pointer',
              flex: 'none',
              font: 'inherit',
            },
          },
          insertIcon(12),
        );

      const skillRow = (skill: SkillEntry) =>
        disclosureRow(`skill:${skill.name}`, skill.enabled, skill.name, skill.description, [
          stateMeta(skill),
          insertButton(skill.name),
          blockedChip(blocked[skill.name] ?? 0),
          switchControl('skill', skill.name, skill.enabled),
        ]);

      const mcpToolRow = (tool: McpServerEntry['tools'][number], serverEnabled: boolean) =>
        disclosureRow(`mcp-tool:${tool.name}`, tool.enabled, tool.label, tool.description, [
          blockedChip(blocked[tool.name] ?? 0),
          serverEnabled ? switchControl('mcp-tool', tool.name, tool.enabled) : null,
        ], MCP_TOOL_ROOT_CLASS);

      const serverRow = (server: McpServerEntry) => {
        const serverBlocked = server.tools.reduce((sum, tool) => sum + (blocked[tool.name] ?? 0), 0);
        const key = `mcp:${server.server}`;
        const disclosure = resolveDisclosure(expanded[key] === true, filtering);
        const ariaLabel = disclosureAria(server.server, 'detail.tools', disclosure);
        // The server root owns state and the panel; only its header owns hover
        // feedback, so nested tool hover never paints the whole server.
        return h(
          Collapsible.Root,
          {
            key,
            open: disclosure.open,
            onOpenChange: (open: boolean) => { setOpen(key, open); },
            style: { opacity: server.enabled ? 1 : 0.55 },
          },
          h(
            'div',
            { className: ROW_HEADER_CLASS },
            h(
              Collapsible.Trigger,
              {
                className: 'ci-server-trigger',
                disabled: disclosure.disabled,
                'aria-label': ariaLabel,
                style: {
                  display: 'grid',
                  placeItems: 'center',
                  width: '18px',
                  height: '18px',
                  padding: 0,
                  border: 'none',
                  borderRadius: '4px',
                  background: 'transparent',
                  color: TOK.textTertiary,
                  cursor: disclosure.disabled ? 'default' : 'pointer',
                  flex: 'none',
                  font: 'inherit',
                },
              },
              h('span', { className: 'ci-chevron', 'aria-hidden': true }, chevronIcon),
            ),
            nameText(server.server),
            metaText(server.tools.length === 1 ? t('server.tool.one') : t('server.tools', { count: server.tools.length })),
            blockedChip(serverBlocked),
            switchControl('mcp-server', server.server, server.enabled),
          ),
          h(
            Collapsible.Panel,
            { className: 'ci-collapse' },
            h(
              'div',
              {
                style: {
                  marginTop: '2px',
                  marginLeft: '4px',
                  paddingLeft: '8px',
                  borderLeft: `2px solid ${TOK.border}`,
                },
              },
              // One tool per row; each description is a second-level disclosure
              // using the same hover/chevron language as Skills and System tools.
              ...server.tools.map((tool) => mcpToolRow(tool, server.enabled)),
            ),
          ),
        );
      };

      const systemRow = (tool: ToolEntry) =>
        disclosureRow(`sys:${tool.name}`, tool.enabled, tool.label, tool.description, [
          blockedChip(blocked[tool.name] ?? 0),
          // run_code is the reserved Code Mode transport: the registry
          // refuses to restrict it, so no switch.
          tool.reserved === true ? null : switchControl('system-tool', tool.name, tool.enabled),
        ]);

      const emptyNote = (text: string) =>
        h('div', { key: `empty:${text}`, style: { color: TOK.textTertiary, padding: '8px 2px' } }, text);


      const notices = [
        snap.loading && payload === null
          ? h('div', { key: 'loading', 'aria-live': 'polite', style: { color: TOK.textTertiary, padding: '4px 0' } }, t('status.loading'))
          : null,
        // A transport failure must not be mistaken for an empty catalog.
        snap.error !== null
          ? h(
              'div',
              { key: 'error', 'aria-live': 'polite', style: { color: TOK.error, padding: '4px 0' } },
              t('status.error', { error: snap.error }),
            )
          : null,
        // Partial reads are reported, so a short list is never silently wrong.
        // The host note itself stays English (diagnostic payload, keyed by the
        // raw note); the visible label around it is localized.
        payload?.degraded !== undefined
          ? h(
              'div',
              { key: 'degraded', style: { color: TOK.warn, padding: '2px 0' } },
              ...payload.degraded.map((note) => h('div', { key: note }, t('degraded.item', { note }))),
            )
          : null,
      ];

      // Filtered: one flat, fully expanded result list. Otherwise: tabs.
      const body = filtering
        ? [
            view !== null && view.total === 0 ? emptyNote(t('empty.match')) : null,
            skills.length > 0 ? groupLabel(t('group.skills', { shown: skills.length, total: totals.skills }), true) : null,
            ...skills.map(skillRow),
            mcp.length > 0 ? groupLabel(t('group.mcp', { shown: mcp.length, total: totals.mcp }), skills.length === 0) : null,
            ...mcp.map(serverRow),
            systemTools.length > 0
              ? groupLabel(t('group.system', { shown: systemTools.length, total: totals.systemTools }), skills.length === 0 && mcp.length === 0)
              : null,
            ...systemTools.map(systemRow),
          ]
        : [
            h(
              Tabs.Root,
              {
                key: 'tabs',
                value: tab,
                onValueChange: (value: string) => { setTab(value); },
                style: { marginTop: '2px' },
              },
              h(
                Tabs.List,
                { 'aria-label': t('tabs.aria'), className: 'ci-tabs', style: { marginBottom: '6px' } },
                h(Tabs.Tab, { value: 'skills', className: 'ci-tab' }, `${t('tab.skills')} ${totals.skills}`),
                h(Tabs.Tab, { value: 'mcp', className: 'ci-tab' }, `${t('tab.mcp')} ${totals.mcp}`),
                h(Tabs.Tab, { value: 'system', className: 'ci-tab', 'aria-label': t('tab.system.aria', { count: totals.systemTools }) }, `${t('tab.system')} ${totals.systemTools}`),
              ),
              h(
                Tabs.Panel,
                { value: 'skills' },
                skills.length === 0 && payload !== null && !snap.loading
                  ? emptyNote(t('empty.skills'))
                  : h('div', {}, ...skills.map(skillRow)),
              ),
              h(
                Tabs.Panel,
                { value: 'mcp' },
                mcp.length === 0 && payload !== null && !snap.loading
                  ? emptyNote(t('empty.mcp'))
                  : h('div', {}, ...mcp.map(serverRow)),
              ),
              h(
                Tabs.Panel,
                { value: 'system' },
                systemTools.length === 0 && payload !== null && !snap.loading
                  ? emptyNote(t('empty.system'))
                  : h('div', {}, ...systemTools.map(systemRow)),
              ),
            ),
          ];

      return h(
        Popover.Root,
        { open: snap.open, onOpenChange: syncOpen },
        // The ContextMeter trigger's chrome, verbatim: 28×28, pill radius,
        // secondary label color, hover-only wash.
        h(
          Tooltip,
          { label: t('trigger.tooltip'), side: 'top', delayMs: 200, disabled: snap.open },
          h(
            Popover.Trigger,
            {
              className: 'ci-trigger',
              'aria-label': t('trigger.tooltip'),
              style: {
                display: 'grid',
                placeItems: 'center',
                width: '28px',
                height: '28px',
                padding: 0,
                border: 'none',
                borderRadius: '999px',
                background: 'transparent',
                color: TOK.textSecondary,
                cursor: 'pointer',
                flex: 'none',
                font: 'inherit',
              },
            },
            layersIcon(14),
          ),
        ),
        h(
          Popover.Portal,
          {},
          h(
            Popover.Positioner,
            { side: 'top', align: 'end', sideOffset: 8, collisionPadding: 8, style: { zIndex: 100 } },
            h(
              Popover.Popup,
              {
                className: 'ci-panel',
                'aria-label': t('panel.aria'),
                style: {
                  boxSizing: 'border-box',
                  width: '360px',
                  maxHeight: 'min(60vh, var(--available-height, 60vh))',
                  overflowY: 'auto',
                  padding: '10px 12px',
                  background: TOK.menuBg,
                  color: TOK.textSecondary,
                  border: `1px solid ${TOK.menuBorder}`,
                  borderRadius: '12px',
                  boxShadow: TOK.menuShadow,
                  fontFamily: TOK.fontFamily,
                  fontSize: '12px',
                  lineHeight: '20px',
                  cursor: 'default',
                },
              },

              // Header: the filter is always one keystroke away — opening the
              // panel lands focus in this input (first focusable in the popup),
              // so no toggle stands between the user and narrowing the list.
              h(
                'div',
                { style: { marginBottom: '6px' } },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
                  h(
                    'div',
                    { style: { position: 'relative', flex: '1 1 auto', display: 'flex', alignItems: 'center' } },
                    h(
                      'span',
                      {
                        style: {
                          position: 'absolute',
                          left: '8px',
                          color: TOK.textTertiary,
                          display: 'grid',
                          pointerEvents: 'none',
                        },
                      },
                      searchIcon(12),
                    ),
                    h(Input, {
                      className: 'ci-filter',
                      value: query,
                      placeholder: t('filter.placeholder'),
                      'aria-label': t('filter.aria'),
                      // Not a credential field: keep password managers and the
                      // spellchecker out of it.
                      autoComplete: 'off',
                      spellCheck: false,
                      name: 'ci-filter',
                      onChange: (event: { target: { value: string } }) => { setQuery(event.target.value); },
                      onKeyDown: (event: { key: string; stopPropagation: () => void }) => {
                        // With a query, Escape clears it and the panel stays
                        // open; empty, it bubbles up and closes the panel.
                        if (event.key !== 'Escape' || !filtering) return;
                        event.stopPropagation();
                        setQuery('');
                      },
                      style: {
                        flex: '1 1 auto',
                        minWidth: 0,
                        height: '26px',
                        boxSizing: 'border-box',
                        padding: '0 8px 0 26px',
                        border: `1px solid ${TOK.border}`,
                        borderRadius: '6px',
                        background: TOK.bgBase,
                        color: TOK.textPrimary,
                        font: 'inherit',
                        outline: 'none',
                      },
                    }),
                  ),
                  filtering
                    ? h(
                        'button',
                        {
                          type: 'button',
                          onClick: () => { setQuery(''); },
                          className: 'ci-iconbtn',
                          'aria-label': t('filter.clear'),
                          style: {
                            display: 'grid',
                            placeItems: 'center',
                            width: '20px',
                            height: '20px',
                            padding: 0,
                            border: 'none',
                            borderRadius: '999px',
                            background: 'transparent',
                            color: TOK.textTertiary,
                            cursor: 'pointer',
                            flex: 'none',
                            font: 'inherit',
                            fontSize: '14px',
                            lineHeight: 1,
                          },
                        },
                        '×',
                      )
                    : null,
                ),
                filtering
                  ? h(
                      'div',
                      {
                        'aria-live': 'polite',
                        style: { marginTop: '4px', color: TOK.textTertiary, fontVariantNumeric: 'tabular-nums' },
                      },
                      t('filter.count', { shown: view?.total ?? 0, total: totalAll }),
                    )
                  : null,
              ),

              ...notices,
              ...body,
            ),
          ),
        ),
      );
    }),
  );
}

export const inject = ['slots', 'locale'];
