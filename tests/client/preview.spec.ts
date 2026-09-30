import { describe, expect, it, vi } from 'vitest';

import { openPreviewResource, resolvePreviewOpener } from '../../src/client/preview.js';

/** A plugin context whose optional lookup answers with `value`. */
const context = (value: unknown) => ({ get: () => value });

describe('resolvePreviewOpener', () => {
  it('opens whatever address it is handed through the host service', () => {
    const openResource = vi.fn();
    const open = resolvePreviewOpener(context({ openResource }));
    if (open === undefined) throw new Error('expected an opener');
    open('dsh-resource://file/session/s1/.dsh/skills/demo/SKILL.md');
    expect(openResource).toHaveBeenCalledWith('dsh-resource://file/session/s1/.dsh/skills/demo/SKILL.md');
  });

  it('keeps the service as the receiver', () => {
    // A detached method would lose `this`, and the host's own sidebar service is
    // reached through a guarding proxy that is bound to its target.
    const seen: unknown[] = [];
    const service = { openResource(this: unknown) { seen.push(this); } };
    resolvePreviewOpener(context(service))?.('addr');
    expect(seen).toEqual([service]);
  });

  it('accepts a callable service row', () => {
    const openResource = vi.fn();
    const callable = Object.assign(() => undefined, { openResource });
    expect(resolvePreviewOpener(context(callable))).toBeTypeOf('function');
  });

  it('reports no opener when the deployment has no sidebar service', () => {
    expect(resolvePreviewOpener(context(undefined))).toBeUndefined();
    expect(resolvePreviewOpener(context(null))).toBeUndefined();
    expect(resolvePreviewOpener(context('sidebarRight'))).toBeUndefined();
  });

  it('reports no opener when the service carries no navigation method', () => {
    expect(resolvePreviewOpener(context({}))).toBeUndefined();
    expect(resolvePreviewOpener(context({ openResource: 'not yet' }))).toBeUndefined();
  });
});

describe('openPreviewResource', () => {
  it('opens through the service available at click time', () => {
    const openResource = vi.fn();
    openPreviewResource(context({ openResource }), 'dsh-resource://file/session/s1/a.md');
    expect(openResource).toHaveBeenCalledWith('dsh-resource://file/session/s1/a.md');
  });

  it('still works when the sidebar was not up yet when the panel activated', () => {
    // The regression this guards: the panel used to resolve the service once
    // during activation, so winning the race against the sidebar fiber meant
    // every row silently lost its preview action and never got it back.
    // A service that arrives only later: the lookup must read it per call.
    const box: { service?: unknown } = {};
    const ctx = { get: () => box.service };
    expect(resolvePreviewOpener(ctx)).toBeUndefined();
    const openResource = vi.fn();
    box.service = { openResource };
    openPreviewResource(ctx, 'dsh-resource://file/session/s1/later.md');
    expect(openResource).toHaveBeenCalledWith('dsh-resource://file/session/s1/later.md');
  });

  it('does nothing, and throws nothing, without a sidebar service', () => {
    expect(() => { openPreviewResource(context(undefined), 'addr'); }).not.toThrow();
  });
});