import { describe, expect, it, vi } from 'vitest';

// The real primitives package imports CSS and cannot run under Node; the shared
// stub defines every name icons.ts touches (both host generations' spellings).
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => (await import('./primitives-stub.js')).primitivesStub);

import { IconCordisPlugin, IconSkill, IconSparkle } from '../../src/client/icons.js';
import { serverRowIcon, skillRowIcon, toolRowIcon } from '../../src/client/row-icon.js';

/**
 * A row's leading mark is a host icon, and which host icon it is cannot be read
 * off the rendered element (React elements are opaque). So each case asserts the
 * resolved COMPONENT identity, which is the thing that actually changed on
 * screen — e.g. an MCP server row must not silently go back to the trigger's
 * context-injection glyph.
 */
function iconOf(element: { readonly type: unknown }): unknown {
  return element.type;
}

describe('row icons', () => {
  // Each kind of row wears the glyph the host's own surface for that kind uses:
  // dsh-client-ui-skill's SkillRow for a skill, dsh-client-ui-cordis for a loaded
  // extension, and the host's `others` fallback for a tool.
  it('leads every kind of row with its host glyph', () => {
    expect(iconOf(skillRowIcon())).toBe(IconSkill);
    expect(iconOf(serverRowIcon())).toBe(IconCordisPlugin);
    expect(iconOf(toolRowIcon())).toBe(IconSparkle);
  });

  // The panel does not classify tools: the host resolves a tool's mark by looking
  // the name up in a table of its own built-ins and calling everything else
  // `others`, so a third-party (MCP) name has no host-side type to trust, and a
  // keyword match would only invent one. Hence the function takes no name at all.
  it('takes no tool name, so nothing can classify one', () => {
    expect(toolRowIcon.length).toBe(0);
  });

  it('renders every glyph at the host rows\u2019 14px', () => {
    for (const element of [skillRowIcon(), serverRowIcon(), toolRowIcon()]) {
      expect((element.props as { size?: number }).size).toBe(14);
    }
  });
});