# Changelog

All notable changes to this project will be documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/).

- 面向用户的改动(Add/Change/Fix/Remove)必须记录;内部重构在不改变行为时可归入 Internal。
- 每条一行,从用户视角写(他得到/失去什么),不复制 commit message。
- 发版流程:Unreleased 切段 → 版本号 + 日期 → `git tag vX.Y.Z` → `npm publish` → `gh release create`。

## [Unreleased]

### Added

- Source grouping in the Skills and MCP tabs: entries cluster under labeled divider rules — preset-bundled entries group under their preset's name (detected by matching the discovery directory against preset paths); every other group shows its real directory, abbreviated (`~`, session-cwd-relative) and middle-ellipsized when long.
- One click to the source folder: hovering a group divider reveals a folder icon, and clicking it opens that source directory in the system file manager (macOS `open`, Windows `start`, freedesktop `xdg-open`) via a new loopback-only `POST /api/capability-panel/open-folder` route. The divider's hover tooltip shows the full path.
- MCP server entries now report where the server is configured: `host` for the host composition, or the composing preset's name for preset-scoped servers.

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

[Unreleased]: https://github.com/pure-craft/dsh-capability-panel/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/pure-craft/dsh-capability-panel/releases/tag/v1.0.0
