# Changelog

All notable changes to this project will be documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/).

- 面向用户的改动(Add/Change/Fix/Remove)必须记录;内部重构在不改变行为时可归入 Internal。
- 每条一行,从用户视角写(他得到/失去什么),不复制 commit message。
- 发版流程:Unreleased 切段 → 版本号 + 日期 → `git tag vX.Y.Z` → `npm publish` → `gh release create`。

## [Unreleased]

### Fixed

- 新版 dsh 宿主（cordis ≥ 4.0.x）下面板不再 500：可选宿主服务改经非严格 `ctx.get(name, false)` 通道解析，启动或 HMR 重载中处于激活过渡期的提供方也能正常取到——此前 `settings.register` 可能落在一个 undefined 查询结果上导致整页加载失败。settings scope 首次绑定失败后也会重试，不再缓存坏值。已对 cordis 4.0.2（dev 依赖）与 4.0.4（dsh 0.1.7-alpha.2）实测验证。

## [1.2.1] - 2026-09-17

### Fixed

- MCP tools masked by ANOTHER plugin for the session (e.g. a lazy-load manager's session-scoped restrict) no longer display as on in the session panel: rows now reflect the session's actual reachability, matching how system tools and skills were already judged. Previously the MCP list merged the global registry in and only consulted this plugin's own disable tables, so externally masked tools read as callable when the model cannot call them.

## [1.2.0] - 2026-09-17

Feature release: offline MCP visibility, late-registration defaults enforcement, and a restyled preset picker.

### Added

- MCP servers declared in the host composition stay visible even when they currently register no tools (an on-demand local service that isn't running): the row lists the positions already stored off for it, marked honestly as "no tools registered", with a **Reload** button that hot-swaps the plugin instance to retry the connection now instead of waiting out the client's backoff. Both the session panel and Settings → Capability Panel show it.
- A GitHub feedback link sits at the foot of the session panel.

### Changed

- The preset picker in Settings → Capability Panel is now a borderless pill with a theme-owned popup menu, matching the host's model selector instead of the native `<select>`.

### Fixed

- Tools that register mid-session (an on-demand MCP server connecting after the session was created) no longer bypass the preset's stored defaults: registry changes now re-apply the session's masks, idempotently and per-session serialized.
- Enabling an MCP server from its row now also clears per-tool masks a partial default left behind — previously the row read on while those tools stayed denied.
- MCP server defaults seeded by a preset now display correctly in the session panel: a stored default that covers every tool a server exposes registers as a server-level mask (what the server row reads), while a partial default stays per-tool. Previously the per-tool restricts did deny the calls, but the server row read the server-level map and showed the server on.

## [1.1.1] - 2026-09-11

Bugfix release for the preset-defaults lifecycle and two 0.1.5 host changes.

### Fixed

- Preset defaults now apply when a session's agent preset is switched after creation (the picker recomposes a blank session): seeded masks from the original composition survive the scope rebind, so the session's capability state is torn down and re-seeded from the newly selected preset, with the session's own recorded switches replayed on top. Previously the switch left the original preset's defaults in place and never applied the new ones.
- Capability mutations are serialized per session: seeding, restore, re-seed, and panel toggles all interleave skill I/O with the re-seed teardown, so a preset switch landing mid-seed could pile old-preset masks into the fresh state. One queue per session makes every mutation see a coherent state; cross-session work stays parallel.
- The composer's insert-command button no longer replaces an in-progress draft: newer hosts dropped the slot's `input` snapshot prop, which read as an empty draft and overwrote it. The panel now reads the live draft through the `useInput` selector prop and appends the slash command as before.
- Settings → Capability Panel no longer 503s the whole preset list when one preset fails to mount (e.g. a host upgrade tightened a plugin's config schema, as dsh 0.1.5 did for the persona row): the failing preset is listed as broken with the mount error, and every other preset lists and toggles normally.

## [1.1.0] - 2026-09-09

### Added

- **Source provenance everywhere**: Skills and MCP entries — in both the session panel and Settings → Capability Panel — group under labeled divider rules that say where they come from. Preset-bundled entries group under their preset's name (detected by matching the discovery directory against preset paths); every other group shows its real directory, abbreviated (`~`, session-cwd-relative) and middle-ellipsized when long. Hovering a group divider shows the full path and a folder icon; one click opens that source directory in the system file manager (macOS `open`, Windows `start`, freedesktop `xdg-open`) via the new loopback-only `POST /api/capability-panel/open-folder` route, which also resolves user/project/host/preset sources without a session. MCP servers report their configuration source too: `host` for the host composition, or the composing preset's name.

### Changed

- **UI 升级**: Settings → Capability Panel now speaks the session panel's visual language — compact rounded rows with a hover background instead of per-row hairlines, section titles restyled as real headings (primary, semibold) instead of uppercase micro-labels, and ruled source dividers with cleaner spacing that replace the stacked separator lines.

### Fixed

- Panel-disabled skills no longer misreport their source as `custom`: the disable shadow now inherits the original skill's source and provider, so a disabled `~/.agents` skill still groups under its real source.
- Peer dependency ranges now accept dsh 0.1.3/0.1.5 pre-releases (API compatibility verified through `0.1.5-alpha.1`), so installs against newer dsh builds stop warning.

### Internal

- Removed dead code left over from the pre-surface read path (`collectReplacements`, `SurfaceReplacement`, the `RawEvent.surfaceOp` field, and a compat alias). No behavior change.
- Added `pnpm scan:dead-code` (`scripts/dead-code-scan.mjs`), an advisory dead-code report.

### Documentation

- npm/CI/license badges; zero-configuration install guidance and both entry points; a Support section; CONTRIBUTING.md (English/中文); READMEs now in 日本語 and 한국어.

## [1.0.0] - 2026-09-05

Initial public release.

### Added

- Session capability panel in the composer: every skill, MCP server, and system tool with its true in-context state (`loaded` / `truncated` / `evicted` / `not loaded`) read off the live session's in-memory surface — zero-copy, no log folding.
- Per-session switches for skills, tools, and whole MCP servers, persisted per session id and restored when the session resumes (survives dsh restarts, never leaks across sessions).
- Preset-level default capabilities under Settings → Capability Panel, seeded at agent creation and overridable per session.
- Blocked-attempt counts for capabilities the model still calls after being disabled.
- One-click `/skill-name` composer fill, name/description/state filtering, MCP tools grouped by server.
- Loopback-only data route `/api/capability-panel` (+ `/stats`, `/presets`); panel copy in 中文 and English.

[Unreleased]: https://github.com/pure-craft/dsh-capability-panel/compare/v1.2.1...HEAD
[1.2.1]: https://github.com/pure-craft/dsh-capability-panel/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/pure-craft/dsh-capability-panel/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/pure-craft/dsh-capability-panel/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/pure-craft/dsh-capability-panel/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/pure-craft/dsh-capability-panel/releases/tag/v1.0.0
