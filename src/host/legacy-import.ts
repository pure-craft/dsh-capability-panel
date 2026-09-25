/**
 * TEMPORARY(dsh-0.1.7-migration) — 一次性遗留数据恢复，过渡期结束后整个删除。
 *
 * 删除时一起移除：
 *   - 本文件与 tests/host/legacy-import.spec.ts
 *   - src/index.ts 里的 scheduleLegacyRecovery 调用点（同样带 TEMPORARY 标记）
 *   - package.json 的 `yaml` devDependency（仅为解析 settings.yaml.imported 引入）
 *   - src/host/types.ts 里 LoaderLike.await（若无其他调用方）
 *
 * 为什么存在：dsh 0.1.7 的设置迁移器是一次性的——启动时把 `$DSH_HOME/settings.yaml`
 * 改名为 `.imported` 再逐节导入。用 0.1.7 之前的本插件启动过 0.1.7 的用户，其
 * `capability-panel` 分节当时因插件没有 Config 被跳过，数据搁浅在 `.imported` 里
 * 且永远不会被重试。本模块在激活后把那一小节播种回新模型，让这批用户升级即自愈。
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { normalizeToolkitSettings } from './settings-schema.js';
import { TOOLKIT_SETTINGS_NAMESPACE } from './settings-scope.js';
import type { HostServices, ToolkitSettings } from './types.js';
import type { ToolkitSettingsAccess } from './settings-scope.js';

/** `$DSH_HOME` 解析，与 stats-store 保持同一惯例。 */
export function legacySettingsDir(environment: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return environment['DSH_HOME'] ?? join(home, '.dsh');
}

/**
 * 从 `.imported` 文档里读出本插件的遗留分节。
 *
 * 任何一步不符预期都返回 undefined 而不是抛出：这是恢复路径，不是配置加载，
 * 一个损坏或陌生的文件绝不能影响插件激活。0.1.6 时代分节按注册命名空间
 * （字面量 `capability-panel`）存储，与 profile 条目 id 无关，所以这里只按
 * 字面量查找。
 */
export function readLegacyToolkitSection(file: string): ToolkitSettings | undefined {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = parse(text);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== 'object') return undefined;
  const section = (parsed as Record<string, unknown>)[TOOLKIT_SETTINGS_NAMESPACE];
  if (section === null || typeof section !== 'object') return undefined;
  return normalizeToolkitSettings(section);
}

function isEmptySection(section: ToolkitSettings): boolean {
  return (
    Object.keys(section.presets).length === 0 &&
    Object.keys(section.presetSkills).length === 0 &&
    Object.keys(section.sessions).length === 0
  );
}

/** 恢复结果，供测试精确断言各分支。 */
export type LegacyRecoveryOutcome =
  | 'seeded'
  | 'skipped:disposed'
  | 'skipped:active-document-present'
  | 'skipped:no-imported-section'
  | 'skipped:no-scope'
  | 'skipped:section-not-empty'
  | 'skipped:legacy-section-empty'
  | 'skipped:write-failed';

/**
 * 执行一次恢复尝试。除 'seeded' 外的返回值都是安全跳过；唯一会真正写入的
 * 情况是：宿主的迁移器已经跑过（无 settings.yaml）、`.imported` 里有我们的
 * 分节、当前存储完全为空（绝不覆盖更新后的数据）、且遗留分节本身非空。
 */
export async function recoverLegacyToolkitSection(
  access: ToolkitSettingsAccess,
  isDisposed: () => boolean,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<LegacyRecoveryOutcome> {
  if (isDisposed()) return 'skipped:disposed';
  const dir = legacySettingsDir(environment);
  // settings.yaml 还在：宿主自己的迁移器会处理它（可能已经排在本进程稍后），
  // 我们不与它竞争，也不去读那份更新鲜的文件。
  if (existsSync(join(dir, 'settings.yaml'))) return 'skipped:active-document-present';
  const legacy = readLegacyToolkitSection(join(dir, 'settings.yaml.imported'));
  if (legacy === undefined) return 'skipped:no-imported-section';
  if (isEmptySection(legacy)) return 'skipped:legacy-section-empty';
  const scope = access.scope();
  if (scope === undefined) return 'skipped:no-scope';
  if (!isEmptySection(scope.get())) return 'skipped:section-not-empty';
  try {
    await scope.replace(legacy);
  } catch {
    // 写入失败（条目尚未可配置、服务正重载……）：保持搁浅现状，不做无谓重试——
    // 区段仍为空，下次启动会自然再试一次。
    return 'skipped:write-failed';
  }
  return 'seeded';
}

/**
 * 编排恢复：等 Loader 初次装载落定（与 dsh-settings 导入遗留文档用的是同一个
 * 信号）再执行，保证我们的条目已激活、settings 服务已发布。没有 loader.await
 * 的宿主直接执行。整个过程 fire-and-forget，所有失败都在 recover 内部降级。
 */
export function scheduleLegacyRecovery(ctx: HostServices, access: ToolkitSettingsAccess): void {
  let disposed = false;
  ctx.effect(() => () => {
    disposed = true;
  }, 'capability-panel: legacy settings recovery (temporary)');
  const loader = ctx.get('loader', false);
  const ready = typeof loader?.await === 'function' ? loader.await() : Promise.resolve();
  void ready.then(
    () => recoverLegacyToolkitSection(access, () => disposed),
    () => recoverLegacyToolkitSection(access, () => disposed),
  );
}