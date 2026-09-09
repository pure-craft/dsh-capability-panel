# Changelog

All notable changes to this project will be documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/).

- 面向用户的改动(Add/Change/Fix/Remove)必须记录;内部重构在不改变行为时可归入 Internal。
- 每条一行,从用户视角写(他得到/失去什么),不复制 commit message。
- 发版流程:Unreleased 切段 → 版本号 + 日期 → `git tag vX.Y.Z` → `npm publish` → `gh release create`。

## [Unreleased]

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

[Unreleased]: https://github.com/pure-craft/dsh-capability-panel/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/pure-craft/dsh-capability-panel/releases/tag/v1.0.0
