import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// This SSR smoke test observes panel copy and host-control props, not the
// accessibility or interactive behavior of the host's implementations.
const controls = vi.hoisted(() => ({ switches: [] as { checked: boolean; disabled?: boolean; label: string }[] }));
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Menu: (props: { anchor: React.ReactElement }) => props.anchor,
  Switch: (props: { checked: boolean; disabled?: boolean; label: string }) => {
    controls.switches.push(props);
    return null;
  },
}));
vi.mock('@base-ui/react/tabs', () => ({ Tabs: {
  Root: (props: { children: React.ReactNode }) => React.createElement('div', null, props.children),
  List: (props: { children: React.ReactNode; 'aria-label': string }) => React.createElement('div', { role: 'tablist', 'aria-label': props['aria-label'] }, props.children),
  Tab: (props: { children: React.ReactNode }) => React.createElement('button', { role: 'tab' }, props.children),
} }));
vi.mock('../../src/client/store.js', () => ({
  subscribe: () => () => {},
  getSnapshot: () => ({ open: false, loading: false, payload: null, error: null }),
  refresh: vi.fn(),
  setCapability: vi.fn(),
}));
import { InsightsSection } from '../../src/client/insights.js';

const localeSnapshot = { active: 'zh-CN', revision: 0 };
const props = { subscribeLocale: () => () => {}, getLocaleSnapshot: () => localeSnapshot };

beforeEach(() => { controls.switches.length = 0; });

describe('insights section initial SSR copy and control wiring', () => {
  it('shows standalone scope, categories and user-directed history indexing', () => {
    const markup = renderToStaticMarkup(React.createElement(InsightsSection, props));
    expect(markup).toContain('工具洞察');
    expect(markup).toContain('全局');
    expect(markup).toContain('Skills');
    expect(markup).toContain('未使用优先');
    expect(markup).toContain('补录历史会话');
    expect(markup).toContain('打开会话后才可调整');
    expect(markup).not.toContain('当前工作区');
    expect(controls.switches).toHaveLength(1);
    expect(controls.switches[0]).toMatchObject({ checked: false, disabled: true, label: '显示工具洞察入口' });
  });
  it('uses current-workspace default for a session, without broadening toggle scope', () => {
    const markup = renderToStaticMarkup(React.createElement(InsightsSection, { ...props, sessionId: 's' }));
    expect(markup).toContain('当前工作区');
    expect(markup).toContain('不会修改 preset 或全局配置');
    expect(markup).toContain('不会自动关闭');
    expect(markup).not.toContain('每日');
  });
});
