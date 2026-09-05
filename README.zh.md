# dsh-capability-panel

[English](README.md) | 中文

**看清你的 DeepSeek Harness agent 此刻真正能触达什么——并且随时开关，按会话或按 preset。**

一个面向当前对话能力面的面板：每个技能、每个 MCP 服务器、每个系统工具，都有真实的"在不在上下文里"状态，和一个从下一步模型调用就生效的开关。

![能力面板:技能带加载状态、MCP 按服务器分组、每行一个开关](docs/images/panel.zh.svg)

---

## 速查(agent 快速参考)

| | |
|---|---|
| 是什么 | [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)(`dsh`)的 web 插件:一个面板,列出当前会话的技能、MCP 服务器、系统工具及其真实的在不在上下文状态,并能逐项开关 |
| 什么时候用 | 回答"为什么 agent 不知道这个技能";看一个加载过的技能是否挺过了剪枝/压缩;只在当前会话里关掉某个工具或 MCP 服务器;为 preset 设置默认能力集合;统计关闭后被拦截的调用次数 |
| 安装 | `dsh plugin --profile web add dsh-capability-panel`(然后重启 dsh) |
| 要求 | dsh web profile,dsh ≥ 0.1.2-rc.1;`@deepseek-ai/*` peer 全部由宿主提供 |
| 数据 | `$DSH_HOME/settings.yaml` 的 `capability-panel` 命名空间;统计在 `$DSH_HOME/capability-panel/stats.jsonl`;loopback API `/api/capability-panel` |
| 包 | npm 上的 `dsh-capability-panel`;bundle id `capability-panel` |

## 为什么

技能"装好了"和技能"此刻在模型的上下文里"是两件事——而只有后者能回答"为什么 agent 不知道这个"。两者之间隔着上下文管理：工具结果剪枝器会截断过长的返回，压缩会把整段历史换成一条摘要。你眼看着五分钟前加载过的技能，可能已经部分或全部离开了模型的视野，而它的加载记录还永久躺在日志里，假装一切如常。

有时你也只是想让模型在这一个对话里别再碰某个工具——不是卸载插件，不是改配置文件重启，就只是这一个会话、从下一步开始。

这个插件把这两件事变成输入框右侧的一个面板。

## 功能

- **真实的加载状态。** 每个技能报告的是模型在下一次请求里实际能看到什么：`已加载`（完整指令在上下文里）/ `已截断`（剪枝器留下首尾、挖掉中间）/ `已挤出`（被压缩整体吞掉）/ `未加载`——外加累计加载次数，被挤出后重新加载的技能读作"已加载 ×2"。
- **重启不丢的会话级开关。** 关掉当前会话里的一个技能、一个工具或一整个 MCP 服务器：从下一次提示组装生效，重启 dsh 后随该会话恢复，且绝不碰其他会话、绝不动对话历史。
- **Preset 默认。** 设置 → 能力面板，为每个 agent preset 存一份默认能力集合；之后新建或恢复的会话继承它。与会话面板同一套筛选、分组和开关——preset 默认只是起点，会话里仍然可以覆盖。
- **MCP 按服务器分组。** 两个服务器挂着两百个工具也能扫得过来：折叠成每服务器一行，一次开关整组。
- **拦截计数。** 模型在你关掉某项之后仍然尝试调用，面板会计数——这是"模型在凭记忆行动、开关需要更响亮的告知"的信号。
- **一键填入命令。** 技能行上的纸飞机按钮把 `/skill-name` 放进输入框，等你自己的回车。
- **快速筛选。** 按名称、描述或状态文案匹配（搜"已截断"或"truncated"都可以），命中时描述自动展开。
- **跟随界面语言。** 面板文案随宿主在中英文之间切换。

## 安装

从插件市场，或直接从仓库安装：

```bash
dsh plugin --profile web add dsh-capability-panel
# 或
dsh plugin --profile web add github:pure-craft/dsh-capability-panel
```

安装后需要重启 dsh 才生效。

要求 DeepSeek Harness 的 web profile(`dsh web`),dsh ≥ 0.1.2-rc.1。所有 `@deepseek-ai/*` 运行时件都由宿主以 peer 依赖形式提供——没有别的要装。

## 使用

打开任意对话，点输入框右侧的上下文图标，面板向上展开。

- 顶部三个分区：**技能 N** / **MCP N** / **工具 N**，各带实时计数
- 每行右侧的开关立即生效——不刷新、不重启
- 点击行本身展开描述
- 顶部筛选框匹配名称、描述或状态文案，下方有 `X / Y` 命中计数
- 被关闭的行变暗，同时模型的系统提示里会被告知"用户关闭了这些能力"

`run_code` 是保留的 Code Mode 传输通道——注册表禁止遮罩它，所以它的开关锁定为开。

两个作用域，同一组开关：**输入框里的面板**绑定你眼前的会话（重启后随它恢复）;**设置 → 能力面板**决定之后每个会话从什么状态开始。Preset 默认在会话 agent 创建时读取——不改写 preset 文件，也不改变已经在运行的 agent。

## 工作原理

**加载状态直接读 live session 的内存 surface，而不是每次从日志折叠。** 面板借用正在运行的会话自身的视图——`session.snapshotEvents()` 拿事件引用、`session.surface.nodes` 拿增量维护的"下一次请求模型可见"的事件集合——一次读取就是一次零拷贝扫描：没有日志克隆、没有回放校验、没有跨读竞态。技能的状态由它那次 `skill` 调用**配对的工具结果**决定，而不是调用本身：压缩后高序号的摘要节点会占据被遮蔽区间的位置，表面顺序不再跟随序号顺序，任何数值区间判断都会误判后续的压缩。

**开关发生在两层。** 全局工具走 `tools.restrict`，在注册表层遮罩，派发时报 `UNKNOWN_TOOL`。preset 级系统工具无法这样遮罩，所以走两条路：`system-prompt/assemble` 事件在每次组装时摘掉它的 schema（模型既看不到它、也不为它花上下文）,`tools.guard` 兜底执行（模型凭记忆调用会被拒绝）。技能的开关是同名影子：在 agent 自己的作用域层注册一个 `modelInvocable: false` 的同名技能——分层注册表让最近的作用域赢得这个名字，而 `/name` 用户调用仍然可用。

**会话开关按会话绑定并持久化，但绝不写进对话日志。** 每次切换都记录在插件设置命名空间下、以会话自己的 id 为键，所以恢复的会话会在 preset 默认之上拿回自己的开关——而一个会话的开关绝不会串到另一个会话。"这些已关闭"的提示在每次组装时现算，任何地方都不会留下过时残留。

**统计不参与控制流。** 拦截计数写在 JSONL 追加日志里，启动时重放恢复；任何 I/O 失败都被吞掉，绝不允许影响开关本身。

## 数据存放

- Preset 默认值与会话绑定的开关位置：`$DSH_HOME/settings.yaml` 的 `capability-panel` 命名空间（会话开关在 `sessions.<sessionId>` 下，最多保留 200 个会话、最旧的先淘汰）。宿主从不丢弃未加载插件的分节，所以卸载后它们还在，直到你手动删除该段。
- 拦截统计：`$DSH_HOME/capability-panel/stats.jsonl`，可直接读取：`curl 'http://127.0.0.1:3080/api/capability-panel/stats'`。

数据路由只接受 loopback 请求，判定依据是连接对端地址。

## 开发

```bash
pnpm install
pnpm dev        # watch 构建
pnpm build      # 构建 host 与 client 两半
pnpm test       # 跑测试
pnpm typecheck  # 类型检查
pnpm lint       # oxlint(含 type-aware 规则)
pnpm check      # typecheck + lint + test(100% 覆盖率门槛)
```

改动 host 半需要重启 dsh;client 半在 `dsh web` 与 watch 构建同时运行时热替换。

## 许可证

[MIT](LICENSE)
