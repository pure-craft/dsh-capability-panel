# dsh-agent-toolkit

English | [中文](README.zh.md)

A per-session skill and tool panel for DeepSeek Harness: see what the model actually has in hand on this step, and switch it off for one session.

---

## What it solves

A skill being *installed* and a skill being *in the model's context right now* are two different facts, and only the second one answers "why doesn't the agent know this". Compaction replaces a span of history with a single summary, so a skill loaded earlier keeps its load record in the durable log forever while it has already disappeared from the model's view.

Likewise, you may want the model to stop reaching for one tool in one conversation — not uninstall a plugin, not edit a config file and restart, just this session, starting from the next step.

This plugin turns both of those into a panel in the bottom-right of the conversation.

## Features

- **Three sections**: skills, MCP, and system tools, each with its own count
- **Load state**: every skill reads `loaded` (still in context), `evicted` (compaction took it), or `unloaded`, with its cumulative load count — a skill reloaded after an eviction reads "loaded ×2"
- **Per-session switches**: turning a skill or tool off hides it from the next prompt assembly onward, while the existing conversation history and already-loaded instructions stay untouched
- **MCP grouped by server**: switch one tool off, or the whole server at once
- **Blocked-attempt counts**: how many times the model still called a capability after it was turned off. A nonzero count means the model is acting from memory — the signal for whether the switch needs to tell the model more explicitly
- **One-click command fill**: the button on a skill row drops `/skill-name` into the composer
- **Filtering**: match on name or description, with matching descriptions auto-expanded while a filter is active

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
- The filter box at the top matches name or description, with `X / Y matched` at its right
- A disabled item renders dimmed, and generates a note in the model's system prompt ("the user has turned off the following capabilities; do not attempt to call them")

`run_code` is the reserved Code Mode transport — the registry forbids masking it, so it carries no switch.

## How it works

**Load state is derived from the log, not read from a registry.** The plugin reads the session log through `dsh-session-query` and classifies every event with the host's own surface fold: `current` (still on the surface, so the model sees it), `shadowed` (replaced by compaction), and `log-only` (never on the surface). A skill's state comes from the verdict on the tool result **paired with** its `skill` call — not the call itself, because after a compaction a high-seq summary node sits at the shadowed range's *position*, so surface order stops tracking seq order and a numeric `start <= seq <= end` test silently misjudges later compactions.

**Switching happens at two layers.** A global tool goes through `tools.restrict`, which masks it at the registry level so dispatch reports `UNKNOWN_TOOL`. `restrict` cannot mask a preset-level system tool, so those take two paths instead: the `system-prompt/assemble` event drops the tool's schema at every assembly (the model neither sees it nor spends context on it), and `tools.guard` backstops execution (a model calling it from memory is denied). Both register at the host level and match the exact agent id, so no other session is affected.

**A skill's switch is a same-name shadow.** It registers a same-name skill with `modelInvocable: false` in that agent's own scope layer. The layered registry lets the nearest scope win the name, so the model-facing catalog and the `skill` loader both stop offering it, while `/name` user invocation stays available. Re-enabling disposes the shadow and the original wins again.

**State is process-local and never written to the log.** Switch state is deliberately not a durable event: reopening a restored session starts from the preset's normal capabilities, and the conversation history itself is never affected.

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
