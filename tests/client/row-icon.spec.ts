import { describe, expect, it, vi } from 'vitest';

// The real primitives package imports CSS and cannot run under Node; the shared
// stub defines every name icons.ts touches (both host generations' spellings).
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => (await import('./primitives-stub.js')).primitivesStub);

import {
  IconApi,
  IconBrowse,
  IconCode,
  IconCordisPlugin,
  IconEdit,
  IconSearch,
  IconSkill,
  IconSparkle,
} from '../../src/client/icons.js';
import { serverRowIcon, skillRowIcon, toolRowIcon, toolVariant } from '../../src/client/row-icon.js';

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

const toolCases: readonly (readonly [string, unknown])[] = [
  // The host's own variant vocabulary, exercised on this harness's real tool
  // names: `bash` is its terminal variant (IconApi), read-ish tools are
  // IconBrowse, write-ish IconEdit, code IconCode, search IconSearch.
  ['bash', IconApi],
  ['mcp__yunxiao__execute_pipeline_job_run', IconApi],
  ['run_code', IconCode],
  ['glob', IconSearch],
  ['grep', IconSearch],
  ['web_search', IconSearch],
  ['mcp__web-search__search', IconSearch],
  ['read', IconBrowse],
  ['read_image', IconBrowse],
  ['web_fetch', IconBrowse],
  ['list_agents', IconBrowse],
  ['mcp__yunxiao__get_repository', IconBrowse],
  ['write', IconEdit],
  ['edit', IconEdit],
  ['todo_write', IconEdit],
  ['update_goal', IconEdit],
  // No rule matches: the host gives an unclassified tool its own `others` glyph.
  ['present', IconSparkle],
  ['create_goal', IconSparkle],
  ['subagent', IconSparkle],
  ['mcp__web-search__expand_link', IconSparkle],
];

describe('toolVariant', () => {
  it('classifies every real tool name into the host variant vocabulary', () => {
    for (const [name, icon] of toolCases) {
      expect(iconOf(toolRowIcon(name)), name).toBe(icon);
    }
  });

  // Rule order is load-bearing: `run_code` must be code, not a write/read-ish
  // match, and the classification is case-insensitive because tool names are
  // not spelled consistently across hosts.
  it('tests the code rule before write and read, and ignores case', () => {
    expect(toolVariant('RUN_CODE')).toBe('code');
    expect(toolVariant('read_code')).toBe('code');
    expect(toolVariant('')).toBe('others');
  });

  it('matches on word starts only', () => {
    // `read` appears inside these names but never starts a word.
    expect(toolVariant('misread')).toBe('others');
    expect(toolVariant('thread')).toBe('others');
  });
});

describe('row icons', () => {
  // The host's own skill row leads with IconSkill (dsh-client-ui-skill), and an
  // MCP server is an installed extension — the glyph dsh-client-ui-cordis uses
  // for one — never the panel trigger's context-injection mark.
  it('leads a skill row with the host skill glyph', () => {
    expect(iconOf(skillRowIcon())).toBe(IconSkill);
    expect(iconOf(serverRowIcon())).toBe(IconCordisPlugin);
  });

  it('renders every glyph at the host rows\u2019 14px', () => {
    for (const element of [skillRowIcon(), serverRowIcon(), toolRowIcon('bash')]) {
      expect((element.props as { size?: number }).size).toBe(14);
    }
  });
});