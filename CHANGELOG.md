# Changelog

All notable changes to this project will be documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/).

- 面向用户的改动(Add/Change/Fix/Remove)必须记录;内部重构在不改变行为时可归入 Internal。
- 每条一行,从用户视角写(他得到/失去什么),不复制 commit message。
- 发版流程:Unreleased 切段 → 版本号 + 日期 → `git tag vX.Y.Z` → `npm publish` → `gh release create`。

## [Unreleased]

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
