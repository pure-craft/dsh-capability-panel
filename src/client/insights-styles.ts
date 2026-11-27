/** Settings/row geometry reuses the existing host-aligned panel classes. */
export const INSIGHTS_CSS = [
  '.ci-insights-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:10px}',
  '.ci-insights-controls{display:flex;flex-wrap:wrap;gap:10px;align-items:center}',
  '.ci-insights-control{display:flex;align-items:center;gap:8px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}',
  '.ci-insights-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}',
  '.ci-insights-row{display:flex;align-items:center;gap:12px;min-height:36px}',
  '.ci-insights-copy{display:flex;flex-direction:column;gap:5px;min-width:0;flex:1;padding:4px 0}',
  '.ci-insights-name{font-size:14px;line-height:20px;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary)}',
  '.ci-insights-meter{height:4px;width:100%;max-width:180px;overflow:hidden;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover)}',
  '.ci-insights-meter-fill{display:block;height:100%;border-radius:inherit;background:var(--dsw-alias-state-business-primary)}',
  '.ci-insights-count{font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap}',
  '.ci-insights-message{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}',
  '.ci-insights-error{color:var(--dsw-alias-state-error-primary)}',
  '@media(prefers-reduced-motion:reduce){.ci-insights-meter-fill{transition:none}}',
].join('\n');
