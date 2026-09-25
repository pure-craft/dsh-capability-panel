export const TOK = {
  textPrimary: 'var(--dsw-alias-label-primary, #0f1115)',
  textSecondary: 'var(--dsw-alias-label-secondary, #61666b)',
  textTertiary: 'var(--dsw-alias-label-tertiary, #81858c)',
  border: 'var(--dsw-alias-border-l1, rgba(0,0,0,.04))',
  /** Hairline rules that must stay visible (the host menu footer divider's token). */
  borderStrong: 'var(--dsw-alias-border-l2, rgba(0,0,0,.1))',
  switchOn: 'var(--dsw-alias-state-business-primary, #4176e6)',
  switchOff: 'var(--dsw-alias-border-l2, rgba(0,0,0,.1))',
  switchThumb: 'var(--dsw-alias-bg-layer-1, #ffffff)',
  switchEase: 'var(--ds-ease-in-out, cubic-bezier(.4, 0, .2, 1))',
  menuBg: 'var(--dsw-specific-menu, #ffffff)',
  menuBorder: 'var(--dsw-alias-border-inverted, rgba(0,0,0,.1))',
  menuShadow: 'var(--dsw-shadow-lv3, 0 12px 32px rgba(0,0,0,.22))',
  // dsh 0.1.7 made menu surfaces translucent (--dsw-specific-menu is now
  // #f8f9fa94) and pairs them with this blur; a surface that takes the color
  // without the filter reads as a dirty see-through. Older hosts lack the
  // token, so the fallback keeps their opaque surfaces blur-free.
  menuBlur: 'var(--dsw-menu-backdrop-filter, none)',
  bgBase: 'var(--dsw-alias-bg-base, #ffffff)',
  fontFamily:
    'var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif)',
  success: 'var(--dsw-alias-state-success-primary, #22c55e)',
  warn: 'var(--dsw-alias-state-warn-primary, #f59e0b)',
  error: 'var(--dsw-alias-state-error-primary, #ec1313)',
  /** Informational accent (e.g. a pruned-but-visible skill), decoupled from
   *  the Switch track token so restyling one does not recolor the other. */
  info: 'var(--dsw-alias-state-business-primary, #4176e6)',
} as const;

export const PANEL_CSS = [
  '.ci-trigger:focus-visible,.ci-switch:focus-visible,.ci-iconbtn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:1px;border-radius:999px}',
  '.ci-disclosure-trigger:focus-visible,.ci-server-trigger:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:1px;border-radius:4px}',
  '.ci-tab:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:1px;border-radius:6px}',
  '.ci-trigger:hover,.ci-iconbtn:hover,.ci-server-trigger:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}',
  '.ci-switch:hover:not(:disabled){filter:brightness(1.12)}',
  '.ci-row-head{display:flex;align-items:center;gap:8px;padding:6px 8px;margin:0 -8px;border-radius:8px}',
  '.ci-row-head:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}',
  '.ci-row-head .ci-send{opacity:0;transition:opacity .12s}',
  '.ci-row-head:hover .ci-send,.ci-row-head:focus-within .ci-send{opacity:1}',
  '.ci-filter:focus{border-color:var(--dsw-alias-state-business-primary,#4176e6)}',
  '.ci-filter:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:0}',
  '.ci-filter::placeholder{color:var(--dsw-alias-label-tertiary,#81858c)}',
  '.ci-panel{transform-origin:var(--transform-origin);transition:opacity .14s var(--ds-ease-in-out,ease),transform .14s var(--ds-ease-in-out,ease)}',
  '.ci-panel[data-starting-style],.ci-panel[data-ending-style]{opacity:0;transform:scale(.96) translateY(4px)}',
  '.ci-collapse{height:var(--collapsible-panel-height);transition:height .14s var(--ds-ease-in-out,ease);overflow:hidden}',
  '.ci-collapse[data-starting-style],.ci-collapse[data-ending-style]{height:0}',
  '.ci-toolrow{content-visibility:auto;contain-intrinsic-size:auto 30px}',
  '.ci-disclosure-trigger{min-width:0;display:flex;align-items:center;gap:6px;flex:1 1 auto;padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
  '.ci-disclosure-trigger:disabled,.ci-server-trigger:disabled{cursor:default}',
  '.ci-disclosure-trigger:hover .ci-name{color:var(--dsw-alias-label-primary,#0f1115)}',
  '.ci-description{padding:3px 0 0 24px;line-height:18px;color:var(--dsw-alias-label-tertiary,#81858c);word-break:break-word}',
  '.ci-chevron{display:grid;place-items:center;width:18px;height:18px;flex:none;color:var(--dsw-alias-label-tertiary,#81858c);border-radius:4px}',
  '.ci-chevron svg{transition:transform .12s var(--ds-ease-in-out,ease)}',
  '.ci-server-trigger[aria-expanded="true"] .ci-chevron svg,.ci-disclosure-trigger[aria-expanded="true"] .ci-chevron svg,.ci-preset-part-trigger[aria-expanded="true"] .ci-chevron svg{transform:rotate(90deg)}',
  // Track and active pill follow the host's SegmentedControl recipe: the track
  // is the same translucent fill as a hover state (it reads as a place, not a
  // button), and the one raised part is the active pill on an opaque layer-1
  // surface with the soft elevation ring (0.1.7 made --dsw-specific-menu
  // translucent, which washed the active pill out).
  '.ci-tabs{display:flex;gap:2px;padding:2px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}',
  '.ci-tab{flex:1;height:24px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#61666b);font:inherit;font-size:12px;line-height:1;cursor:pointer;font-variant-numeric:tabular-nums;padding:0 4px}',
  '.ci-tab:hover{color:var(--dsw-alias-label-primary,#0f1115)}',
  '.ci-tab[data-active]{background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#0f1115);box-shadow:var(--dsw-elevation-soft,0 1px 2px rgba(0,0,0,.08))}',
  // Settings page frame follows the host's plugin-inventory page: a 760px
  // column with 14px gaps (measured from its CSS module), primary text on top.
  '.ci-preset-section{width:100%;max-width:760px;color:var(--dsw-alias-label-primary,#0f1115);display:flex;flex-direction:column;gap:14px}',
  '.ci-settings-title{margin:0;color:var(--dsw-alias-label-primary,#0f1115);font-size:18px;font-weight:600;line-height:26px}',
  '.ci-settings-intro,.ci-settings-description,.ci-settings-note{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary,#81858c)}',
  '.ci-settings-note{padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:8px}',
  // Toolbar: a full-width search row (the host inventory page's recipe: icon
  // pinned at left 12px, a 36px input on a 0.5px l4 border) with the preset
  // switcher pinned at its end.
  '.ci-preset-toolbar{display:flex;gap:10px;align-items:center;margin:0}',
  '.ci-search{position:relative;flex:1 1 auto;min-width:180px;display:flex;align-items:center;color:var(--dsw-alias-label-tertiary,#81858c)}',
  '.ci-search>svg{position:absolute;left:12px;pointer-events:none}',
  '.ci-preset-filter{width:100%;height:36px;box-sizing:border-box;padding:0 34px 0 36px;border:.5px solid var(--dsw-alias-border-l4,rgba(0,0,0,.16));border-radius:var(--dsw-radius-md,12px);background-color:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#0f1115);font:inherit;font-size:13px;font-weight:400;outline:none}',
  '.ci-preset-filter:focus-visible{border-color:var(--dsw-alias-state-business-primary,#4176e6);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 18%,transparent)}',
  // Parts are collapsible groups now: hairline-separated (the inventory page's
  // group+group rule), a chevron-led trigger row, title at regular weight, and
  // a tabular count subtitle aligned under the title text.
  '.ci-preset-part{display:flex;flex-direction:column;gap:10px;margin:0;padding:14px 0 0;border-top:.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1))}',
  '.ci-preset-part:first-of-type{border-top:0;padding-top:0}',
  '.ci-preset-part-trigger{display:flex;align-items:center;gap:8px;min-height:32px;padding:0;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}',
  '.ci-preset-part-trigger:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:2px;border-radius:4px}',
  '.ci-preset-part-title{margin:0;font-size:14px;font-weight:400;line-height:22px;color:var(--dsw-alias-label-primary,#0f1115)}',
  '.ci-preset-part-sub{margin:-4px 0 0 26px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#81858c);font-variant-numeric:tabular-nums}',
  // Badge fill: --dsw-alias-bg-fill-2 was deleted from the theme (already gone
  // in 0.1.6); the host's subtle-fill token is the hover-fill alias, which is
  // also what the SegmentedControl track uses. Theme-aware in dark mode, unlike
  // the old rgba fallback.
  '.ci-preset-badge{display:inline-block;margin-left:6px;padding:1px 6px;line-height:1.5;border-radius:999px;font-size:11px;font-weight:500;vertical-align:middle;background-color:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));color:var(--dsw-alias-label-tertiary,#81858c)}',
  '.ci-preset-group{padding:0}',
  '.ci-preset-server-trigger{display:flex;align-items:center;gap:8px;flex:1;min-width:0;background:none;border:none;padding:0;text-align:left;font:inherit;color:inherit;cursor:pointer}',
  '.ci-preset-server-trigger:disabled{cursor:default}',
  '.ci-preset-group .ci-preset-tool-list{margin:0;padding-left:26px}',
  // The preset switcher speaks the host's switcher language (its preset-mode
  // button on the same page): a 36px module-platform pill carrying the current
  // value and a chevron, replacing the old model-selector pill.
  '.ci-preset-picker-trigger{height:36px;display:inline-flex;align-items:center;gap:8px;padding:0 14px;border:none;border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-bg-module-platform,rgba(38,49,72,.06));color:var(--dsw-alias-label-primary,#0f1115);font:inherit;font-size:14px;font-weight:400;line-height:22px;cursor:pointer;outline:none;max-width:280px;flex:none;white-space:nowrap}',
  '.ci-preset-picker-trigger:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}',
  '.ci-preset-picker-trigger:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:2px}',
  '.ci-preset-picker-name{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}',
  '.ci-preset-picker-chevron{color:var(--dsw-alias-label-tertiary,#81858c);flex:none;display:inline-grid;place-items:center;transition:transform .12s}',
  '.ci-preset-picker-chevron-open{transform:rotate(180deg)}',
  '.ci-settings-subtitle{margin:0 0 6px;color:var(--dsw-alias-label-primary,#0f1115);font-size:14px;line-height:22px}',
  // Settings rows speak the composer panel's row language: compact padding,
  // a rounded hover background (`.ci-row-head` supplies both), and NO
  // hairline per row — groups separate through the source dividers alone.
  '.ci-preset-tool-list{list-style:none;margin:0;padding:0}',
  '.ci-preset-tool-row{display:flex;align-items:center;gap:16px}',
  '.ci-preset-tool-copy{display:grid;min-width:0;flex:1}',
  '.ci-preset-tool-name{color:var(--dsw-alias-label-primary,#0f1115);font-weight:600;overflow-wrap:anywhere}',
  '.ci-preset-tool-description{color:var(--dsw-alias-label-tertiary,#81858c);line-height:18px;overflow-wrap:anywhere}',
  '.ci-preset-item{list-style:none}',
  '.ci-preset-disclosure{display:block}',
  // Matches the chevron column so a row without a description still lines up
  // with the rows that have one.
  '.ci-preset-spacer{width:18px;flex:none}',
  '.ci-preset-detail{padding:0 0 10px 24px;color:var(--dsw-alias-label-tertiary,#81858c);line-height:18px;overflow-wrap:anywhere}',
  '.ci-preset-kinds{margin:0}',
  '.ci-preset-kinds .ci-tabs{display:inline-flex}',
  '.ci-preset-kinds .ci-tab{flex:0 0 auto;padding:0 12px}',
  // Folder icon on source section headers: invisible until hover.
  '.ci-source-header:hover .ci-folder-icon{opacity:1 !important}',
  // The reconnect affordance for a declared-but-offline MCP server: a
  // persistent bordered control (never hover-only), with a spinning glyph
  // while the restart is in flight so the click visibly "does something".
  '.ci-reconnect{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-secondary,#61666b);border-radius:8px;padding:3px 9px;font-size:12px;line-height:1.4;cursor:pointer;font-family:inherit;flex:none}',
  '.ci-reconnect:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));color:var(--dsw-alias-label-primary,#0f1115)}',
  '.ci-reconnect:disabled{opacity:.7;cursor:default}',
  '.ci-reconnect:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:1px}',
  '.ci-reconnect-glyph{display:inline-grid;place-items:center;width:12px;height:12px}',
  '.ci-reconnect-busy .ci-reconnect-glyph{animation:ci-reconnect-spin .8s linear infinite}',
  '@keyframes ci-reconnect-spin{to{transform:rotate(360deg)}}',
  '@media (prefers-reduced-motion: reduce){.ci-reconnect-busy .ci-reconnect-glyph{animation:none}}',
  // Source divider rows inside a settings list: labels, not data rows.
  '.ci-source-divider{list-style:none}',
  // Panel foot feedback link: quiet tertiary text, primary on hover/focus.
  '.ci-feedback-link{display:inline-flex;align-items:center;gap:4px;color:var(--dsw-alias-label-tertiary,#8a8f98);font-size:12px;line-height:18px;text-decoration:none;cursor:pointer}',
  '.ci-feedback-link:hover{color:var(--dsw-alias-label-primary,#0f1115);text-decoration:underline}',
  '.ci-feedback-link:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:2px;border-radius:3px}',
  '.ci-feedback-icon{display:inline-grid;place-items:center;flex:none}',
  // The settings entry shares the feedback link's quiet styling but is a
  // <button>, so it also needs the control reset the anchor never did.
  '.ci-settings-link{border:0;background:none;padding:0;font-family:inherit}',
  '@media (prefers-reduced-motion: reduce){.ci-thumb,.ci-panel,.ci-collapse,.ci-chevron svg{transition:none !important}}',
].join('\n');
