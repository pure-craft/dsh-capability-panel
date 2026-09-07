# 贡献指南

感谢帮助改进 dsh-capability-panel![English](CONTRIBUTING.md)

## 报告问题

请附上：

- dsh 版本(`dsh --version`）和操作系统
- 面板实际显示 vs 你的预期（截图更好）
- 面板里的任何 `degraded` 提示——那是插件自带的诊断信息

## 开发环境

```bash
pnpm install --frozen-lockfile
pnpm check          # typecheck + 类型感知 lint + 测试——必须全绿
pnpm test:coverage  # src/** 的 100% 覆盖率门槛——不要下调
pnpm scan:dead-code # 死代码巡检报告(仅提示,先读再删,不做门禁)
```

host 半的改动需要重启 dsh;client 半在 `dsh web` 与 `pnpm dev` 同时运行时热替换。

## 容易踩的约定

- **多语文档同权**:`README.md`、`README.zh.md`、`README.ja.md`、`README.ko.md` 四个版本同等权威。任何一版改动要同步其余三版,然后重录一致性 hash:`git hash-object README.md README.zh.md README.ja.md README.ko.md` 写进 `README.i18n.yaml`。
- **文案键对齐**:`src/client/locale.ts` 的中英字典键集合必须一致(有测试钉住)。
- **wire 契约**:`src/contract.ts` 只有类型;`src/wire.ts` 是它的运行时守卫。新增 payload 字段要两处都改,并补 wire.spec 用例。
- **会话绑定**:能力开关按会话 id 隔离并持久化。绝不能让一个会话的开关串到另一个会话。
- **不做猴子补丁**:只通过 dsh 的正式接缝扩展(`tools.restrict`、`system-prompt/assemble`、settings 命名空间、UI slots)。
- **宿主模块保持 external**:React 和 `@deepseek-ai/*` 客户端模块在 `tsdown.config.ts` 里必须保持 external——打进包的第二个 React 会让 hooks 崩溃。

## 提交 PR

1. Fork,从 `main` 拉分支,改动保持聚焦。
2. 本地 `pnpm check` 和 `pnpm test:coverage` 全绿;CI 跑的是同一套门禁。
3. PR 描述里讲清**为什么**;UI 改动请附截图。
4. 一个 PR 只做一件事——重构和行为变更请拆开。
