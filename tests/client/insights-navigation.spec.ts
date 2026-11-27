import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => ({
  ...(await import('./primitives-stub.js')).primitivesStub,
  Tooltip: () => null,
  Menu: () => null,
}));
vi.mock('@deepseek-ai/dsh-client-store', () => ({
  createSnapshotStore: (initial: unknown) => ({ getSnapshot: () => initial, subscribe: () => () => {}, set: vi.fn() }),
}));

import { apply } from '../../src/client/index.js';
import { InsightsSection } from '../../src/client/insights.js';
import { IconSliders } from '../../src/client/icons.js';

// Execute the real activation and slot callbacks. The fake records only the
// host registration boundary; it does not recreate navigation or rendering.
function activate() {
  const registrations: { spec: Record<string, unknown>; component: unknown }[] = [];
  const ctx: Parameters<typeof apply>[0] = {
    slots: {
      inject: (_name, callback) => { callback(); },
      register: (spec, component) => { registrations.push({ spec, component }); return () => {}; },
    },
    on: () => {},
    effect: () => {},
    get: () => undefined,
    locale: {
      register: () => () => {},
      bind: () => (key: string) => key,
      subscribe: () => () => {},
      getSnapshot: () => ({ active: 'zh-CN', revision: 0 }),
    },
  };
  apply(ctx);
  return registrations;
}

describe('tool insights navigation registration', () => {
  it('registers a sidebar entry with the matching global main panel', () => {
    const registrations = activate();
    const entry = registrations.find(({ spec }) => spec.name === 'sidebar.panellist' && spec.id === 'capability-panel-insights');
    expect(entry?.spec).toMatchObject({ order: 21 });
    expect((entry?.spec.label as () => string)()).toBe('工具洞察');
    const icon = (entry?.component as (props: { size: number }) => React.ReactElement)({ size: 19 });
    expect(icon.type).toBe(IconSliders);
    expect(icon.props).toMatchObject({ size: 19 });

    const main = registrations.find(({ spec }) => spec.name === 'main' && spec.key === entry?.spec.id);
    expect(main).toBeDefined();
    const root = (main?.component as () => React.ReactElement<{ children: React.ReactElement }>)();
    expect(root.props.children.type).toBe(InsightsSection);
    expect(root.props.children.props).toMatchObject({ initialScope: 'global' });
    expect(root.props.children.props).not.toHaveProperty('sessionId');
  });

  it('keeps preset configuration without registering a second insights settings page', () => {
    const settings = activate().filter(({ spec }) => spec.name === 'settings.section');
    expect(settings.map(({ spec }) => spec.id)).toContain('capability-panel');
    expect(settings.map(({ spec }) => spec.id)).not.toContain('capability-panel-insights');
  });
});
