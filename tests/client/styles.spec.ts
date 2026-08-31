import { describe, expect, it } from 'vitest';
import { PANEL_CSS, TOK } from '../../src/client/styles.js';

describe('panel theme contract', () => {
  it('keeps every semantic color on a host token with a concrete fallback', () => {
    for (const value of Object.values(TOK)) {
      expect(value).toMatch(/^var\(--ds/);
      expect(value).toContain(',');
    }
  });

  it('keeps the accessibility and motion selectors in the owned stylesheet', () => {
    expect(PANEL_CSS).toContain('.ci-trigger:focus-visible');
    expect(PANEL_CSS).toContain('.ci-filter:focus-visible');
    expect(PANEL_CSS).toContain('[aria-expanded="true"]');
    expect(PANEL_CSS).toContain('prefers-reduced-motion: reduce');
  });
});
