# dsh-agent-toolkit

English | [中文](README.zh.md)

A skill and tool control surface for DeepSeek Harness: inspect and temporarily tune one running session, or persist the default tool set of each agent preset.

---

## What it solves

A skill being *installed* and a skill being *in the model's context right now* are two different facts, and only the second one answers "why doesn't the agent know this". Compaction replaces a span of history with a single summary, so a skill loaded earlier keeps its load record in the durable log forever while it has already disappeared from the model's view.

Likewise, you may want the model to stop reaching for one tool in one conversation — not uninstall a plugin, not edit a config file and restart, just this session, starting from the next step.

This plugin turns both of those into a panel in the bottom-right of the conversation.

## Features

- **Three sections**: skills, MCP, and system tools, each with its own count
- **Load state**: every skill reads `loaded` (still in context), `pruned` (head/tail survive, the middle was truncated), `evicted` (compaction took it), or `unloaded`, with its cumulative load count — a skill reloaded after an eviction reads "loaded ×2"
- **Per-session switches**: turning a skill or tool off hides it from the next prompt assembly onward, while the existing conversation history and already-loaded instructions stay untouched
- **Preset defaults**: Settings → Agent Toolkit persists a tool allow/deny default for each agent preset; sessions created or resumed afterward inherit it, while the composer's Session context stays per-session. Same filter, same grouping, same switches as the session panel — MCP tools collapse under their server, which can be toggled in one write
- **MCP grouped by server**: switch one tool off, or the whole server at once
- **Blocked-attempt counts**: how many times the model still called a capability after it was turned off. A nonzero count means the model is acting from memory — the signal for whether the switch needs to tell the model more explicitly
- **One-click command fill**: the button on a skill row drops `/skill-name` into the composer
- **Filtering**: match on name or description, with matching descriptions auto-expanded while a filter is active
- **Follows the UI language**: panel copy switches between 中文 and English with the host's language setting

## Install

```bash
dsh plugin --profile web add dsh-agent-toolkit
```

Restart dsh for the install to take effect.

## Usage

Open any conversation and click the layers icon to the right of the composer (28×28, right-aligned); the panel opens upward.

- Three tabs across the top: **Skills N** / **MCP N** / **Tools N**
- The switch sits at the right of each row and takes effect immediately, with no refresh
- Click the row itself to expand its description
- The filter box at the top matches name or description, with an `X / Y matched` count just below it
- A disabled item renders dimmed, and generates a note in the model's system prompt ("the user has turned off the following capabilities; do not attempt to call them")

`run_code` is the reserved Code Mode transport — the registry forbids masking it, so its switch is disabled.

The same switches exist at two scopes: **Session context** in the composer changes the conversation in front of you, and **Settings → Agent Toolkit** changes what every later session starts from. For persistent defaults, open Settings → Agent Toolkit, pick a preset, and switch tools on or off. A preset can expose hundreds of tools, so the section carries the panel's filter and collapses each MCP server into one row with a switch that covers all of its tools. The stored defaults are read when a session agent is created (including a restored session); they do not rewrite the preset files and do not change agents that are already running.

## How it works

**Load state is read off the live session's in-memory surface, not folded from the log on every read.** The panel borrows the running session's own view — `session.snapshotEvents()` for the event references and `session.surface.nodes` for the incrementally maintained set of seqs the model sees on the next request — so a read is one zero-copy scan with no log clones, no replay validation, and no cross-read race. (Going through `sessionQuery.readSession`/`listEvents` instead cloned and re-validated the entire log up to twice per panel open, which froze the host process on long sessions.) A skill's state still comes from the tool result **paired with** its `skill` call — not the call itself, because after a compaction a high-seq summary node sits at the shadowed range's *position*, so surface order stops tracking seq order and a numeric `start <= seq <= end` test silently misjudges later compactions. Three outcomes are distinguished: `loaded` (the full result is on the surface), `pruned` (the tool-result pruner left a head+marker+tail stub on the surface — head and tail still visible to the model), and `evicted` (compaction shadowed the result entirely). The durable log is never touched; these states describe the model's current view, not the archive.

**Switching happens at two layers.** A global tool goes through `tools.restrict`, which masks it at the registry level so dispatch reports `UNKNOWN_TOOL`. `restrict` cannot mask a preset-level system tool, so those take two paths instead: the `system-prompt/assemble` event drops the tool's schema at every assembly (the model neither sees it nor spends context on it), and `tools.guard` backstops execution (a model calling it from memory is denied). Both register at the host level and match the exact agent id, so no other session is affected.

**A skill's switch is a same-name shadow.** It registers a same-name skill with `modelInvocable: false` in that agent's own scope layer. The layered registry lets the nearest scope win the name, so the model-facing catalog and the `skill` loader both stop offering it, while `/name` user invocation stays available. Re-enabling disposes the shadow and the original wins again.

**Session switches are session-bound and persisted, but never written to the conversation log.** Each toggle is recorded in the plugin's settings namespace under the session's own id, so a restored session (a fresh agent after a restart) gets its own switches back on top of its preset defaults — and no session's switches can leak into another. The conversation history itself is never affected: the masks are per-assembly overlays, and the "these are off" prompt note is computed at assembly time, so nothing stale survives in the log. The preset default remains the layer every NEW session starts from.

**Stats stay out of the control flow.** Blocked-attempt counts are appended to a JSONL log and replayed at startup; any I/O failure is swallowed rather than allowed to break the switch itself.

## Where data lives

- Blocked-attempt stats: `$DSH_HOME/agent-toolkit/stats.jsonl`
- The raw stats are readable directly: `curl 'http://127.0.0.1:3080/api/agent-toolkit/stats'`

The data route accepts loopback callers only. The decision keys on the connection's peer address; the Host and Origin headers are a fallback used only when the socket is unavailable, and with neither present the route refuses.

## Development

```bash
pnpm install
pnpm dev        # watch build
pnpm build      # build both the host and client halves
pnpm test       # run the tests
pnpm typecheck  # typecheck
pnpm lint       # oxlint, including its type-aware rules
pnpm check      # typecheck + lint + test
```

A change to the host half needs a dsh restart; the client half hot-swaps while `dsh web` and the watch build run together.

## License

[MIT](LICENSE)
