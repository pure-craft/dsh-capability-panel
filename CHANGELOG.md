# Changelog

All notable changes to this project will be documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/).

- 面向用户的改动(Add/Change/Fix/Remove)必须记录;内部重构在不改变行为时可归入 Internal。
- 每条一行,从用户视角写(他得到/失去什么),不复制 commit message。
- 发版流程:Unreleased 切段 → 版本号 + 日期 → `git tag vX.Y.Z` → `npm publish` → `gh release create`。

## [1.3.0] - 2026-09-26

dsh 0.1.7 兼容与 UI 全面升级：设置存储迁移到插件条目自身的 volatile Config（两代宿主通吃）、控件换装宿主设计系统、设置页对齐内置插件页、新增全局配置入口与遗留数据自动恢复。

### Added

- 控件全面换装宿主 0.1.7 设计系统组件：开关改用宿主 `Switch`（36×20 胶囊、brand-primary 开态、自带禁用变暗与焦点环，替代手绘的 32×18 控件），设置页分类切换改用宿主 `SegmentedControl`（与模型设置页的模式切换同款，28px/13px 标准尺寸）。均按宿主代际探测——0.1.7+ 用宿主组件，旧宿主回退到本地实现，同一构建两代通吃。

- 设置页（设置 → 能力面板）交互与布局升级，逐项对齐宿主「内置插件」页的实测规格：搜索框改为整行宽、放大镜内置（36px 高、0.5px l4 描边、12px 圆角、聚焦时主题色描边加柔光环）；预设选择器改为宿主的切换器样式（36px 模块平台色胶囊，显示当前预设名 + 展开箭头，替代旧的模型选择器胶囊）；「技能 / MCP / 系统工具」三个分组升级为可折叠组（左箭头触发行 + 等宽数字计数副标题 + 组间 l2 发丝分隔线），默认展开、筛选时强制展开；页面骨架对齐为 760px 宽、14px 间距的列布局。

- 会话面板底部栏（全局配置 / 反馈问题）改为常驻固定：列表过长时不再被卷走。布局沿用宿主 Menu 的固定底栏模型——弹层 flex 列、内容在视口内滚动、底栏 `flex: none` 并加 l2 发丝分隔线。

- 会话面板底部新增「全局配置」入口：点击关闭当前面板并**直达**设置中的「能力面板」页。宿主没有分区深链 API，实现是依次驱动两个官方手势：先沿输入管线触发 `settings.open` 快捷键（⌘/Ctrl+,，已打开则跳过以免触发关闭），弹窗挂载后按我们自己的本地化标签点击左侧导航行——全程不触碰宿主内部对象；导航行未出现时降级为落在设置落地页。注意若用户改绑过设置快捷键，开弹窗手势触发的是新绑定的命令。仅在 0.1.7+ 宿主显示（旧宿主没有该快捷键绑定，入口自动隐藏）。
- 升级即自愈的一次性遗留数据恢复（临时机制，过渡期结束后将移除）：先用旧版插件启动过 dsh 0.1.7 的用户，其 `capability-panel` 设置分节当时被宿主迁移器跳过、搁浅在 `$DSH_HOME/settings.yaml.imported` 里；现在插件激活后会自动把该分节播种回新模型。只在当前存储完全为空时播种（绝不覆盖更新后的数据），遗留分节为空或宿主迁移器尚未运行时安全跳过，写入失败留待下次启动自然重试。随此引入的 `yaml` 依赖届时一并移除。

### Fixed

- dsh 0.1.7 下面板与控件不再泛白半透明：宿主把菜单表面色 `--dsw-specific-menu` 改成了半透明色并配套 `backdrop-filter` 毛玻璃，只取色不取模糊的表面会显得"脏透"。面板弹层补齐毛玻璃；分段控件的轨道/激活项与预设角标的填充改对齐宿主 SegmentedControl/Pill 现行 token（`bg-fill-2` 早在 0.1.6 就已被宿主删除）。旧宿主因 token 兜底保持原样。
- dsh 0.1.7 下面板不再空白：宿主的图标集从像素后缀命名（`IconChevronDownOutline14`）改成了描边粗细变体（`…OutlineRegular`/`…Medium`），旧名在新版包里不复存在，React 拿到 undefined 组件直接渲染崩溃。图标改为按名探测（优先新名、回退旧名），同一构建两代通吃；变体选择对齐宿主会话界面惯例（工具图标一律 Regular）。若未来宿主再次改名，面板降级为无图标但功能完整，不再整页崩溃。

- dsh 0.1.7 下所有读写预设/会话开关的操作不再报 `settings.register is not a function`：该版本删除了设置注册 API，改为把可配置数据挂在插件条目自身的 Config 上（按 profile 条目 id 寻址，且仅 volatile 字段可在线写入）。插件现在声明自己的 volatile Config（`presets`/`presetSkills`/`sessions` 三个字段），读取走 `describe()` 描述符、写入走 `replace(条目id, 完整区段)`；≤ 0.1.6 的旧宿主仍走原 `register()` 通道，同一构建两代通吃。命名空间按运行时实际的 profile 条目 id 解析，未经 Loader 挂载时回退到历史字面量 `capability-panel`。volatile 标记用 `.extra('volatile', true)` 施加而非 `.volatile()`——后者仅 schemastery ≥ 3.18.4 才有，旧副本会直接在加载期抛 TypeError，前者在所有受支持版本上产出完全相同的元数据。
- 新版 dsh 宿主（cordis ≥ 4.0.x）下面板不再 500：可选宿主服务改经非严格 `ctx.get(name, false)` 通道解析，启动或 HMR 重载中处于激活过渡期的提供方也能正常取到——此前 `settings.register` 可能落在一个 undefined 查询结果上导致整页加载失败。settings scope 首次绑定失败后也会重试，不再缓存坏值。已对 cordis 4.0.2（dev 依赖）与 4.0.4（dsh 0.1.7-alpha.2）实测验证。
- dsh 0.1.7 下 Settings → Capability Panel 不再报错：宿主把预设注册表拆到了新包并删除了 `standingKeyFor`，面板改为运行时探测——新版走 `acquireScope` 租约（读取完成即释放），旧版（≤ 0.1.6）继续走 `standingKeyFor`，同一构建两代通吃。
- 新版宿主预设花名册不再携带 `trust`/`path`：面板如实省略该字段而不再判整个 payload 非法（旧宿主仍照常显示）。代价是新版宿主下「按预设名打开其目录」暂不可用；工具、技能、开关等全部功能不受影响。

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
