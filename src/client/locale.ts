/**
 * Panel copy, bilingual. Chinese is the authoring language; English is the
 * fallback the host's locale runtime consults after the active locale misses
 * a key (and the locale a browser naming neither shipped language lands on).
 *
 * The dictionaries register into the host's locale service (`ctx.locale`)
 * under this plugin's own namespace, so the panel follows the same language
 * switch as the rest of the UI. Templates interpolate `{name}` placeholders.
 *
 * tests/client/locale.spec.ts pins the two dictionaries to identical key sets
 * and checks every key the component looks up exists in both.
 */

export const LOCALE_NS = 'agent-toolkit';

export const zh: Record<string, string> = {
  'state.loaded': '已加载',
  'state.evicted': '已挤出',
  'state.unloaded': '未加载',
  'blocked.count': '拦截 ×{count}',
  'action.enable': '开启 {name}',
  'action.disable': '关闭 {name}',
  'action.insert': '把 /{name} 填入输入框',
  'server.tools': '{count} 工具',
  'status.loading': '读取中…',
  'status.error': '读取失败：{error}（可尝试刷新页面；Host 改动需重启 dsh 后生效）',
  'empty.match': '无匹配项',
  'empty.skills': '无可用技能',
  'empty.mcp': '无 MCP 服务器',
  'empty.system': '无系统工具',
  'group.skills': '技能 ({shown}/{total})',
  'group.mcp': 'MCP ({shown}/{total})',
  'group.system': '系统工具 ({shown}/{total})',
  'tab.all': '全部',
  'tab.skills': '技能',
  'tab.mcp': 'MCP',
  'tab.system': '工具',
  'tab.system.aria': '系统工具 {count}',
  'tabs.aria': '上下文分区',
  'trigger.tooltip': '会话上下文：技能与 MCP',
  'panel.aria': '会话上下文',
  'filter.placeholder': '筛选名称或描述…',
  'filter.aria': '筛选技能与工具',
  'filter.clear': '清空筛选',
  'filter.count': '匹配 {shown} / {total} 项',
  'disclosure.expand': '展开 {subject} 的{detail}',
  'disclosure.collapse': '收起 {subject} 的{detail}',
  'disclosure.pinned': '{subject} 的{detail}（筛选时保持展开）',
  'detail.description': '描述',
  'detail.tools': '工具',
  'preset.nav': 'Agent Toolkit',
  'preset.title': 'Agent Toolkit',
  'preset.intro': '设置每个 Agent preset 的默认能力集合，之后新建或恢复的会话会继承它。输入框里的「会话上下文」仍然只改当前会话。',
  'preset.projectSkill': '当前项目',
  'preset.kindAria': '按类别筛选',
  'preset.readonly': '当前设置存储不可写；你可以查看工具，但无法保存微调。',
  'preset.choose': 'Agent preset',
  'preset.empty': '没有可用的 Agent preset。',
  'preset.noTools': '这个 preset 没有可用能力。',
  'preset.reserved': '{name} 是保留传输工具，不能关闭。',
  'preset.broken': '这个 preset 无法组装会话：{reason}。修好它之后才能列出工具。',
};

export const en: Record<string, string> = {
  'state.loaded': 'loaded',
  'state.evicted': 'evicted',
  'state.unloaded': 'not loaded',
  'blocked.count': 'blocked ×{count}',
  'action.enable': 'Enable {name}',
  'action.disable': 'Disable {name}',
  'action.insert': 'Insert /{name} into the composer',
  'server.tools': '{count} tools',
  'status.loading': 'Loading…',
  'status.error': 'Failed to load: {error} (try refreshing the page; host changes take effect after a dsh restart)',
  'empty.match': 'No matches',
  'empty.skills': 'No skills available',
  'empty.mcp': 'No MCP servers',
  'empty.system': 'No system tools',
  'group.skills': 'Skills ({shown}/{total})',
  'group.mcp': 'MCP ({shown}/{total})',
  'group.system': 'System tools ({shown}/{total})',
  'tab.all': 'All',
  'tab.skills': 'Skills',
  'tab.mcp': 'MCP',
  'tab.system': 'Tools',
  'tab.system.aria': 'System tools, {count}',
  'tabs.aria': 'Capability sections',
  'trigger.tooltip': 'Session context: skills & tools',
  'panel.aria': 'Session context',
  'filter.placeholder': 'Filter by name or description…',
  'filter.aria': 'Filter skills and tools',
  'filter.clear': 'Clear filter',
  'filter.count': '{shown} / {total} matched',
  'disclosure.expand': 'Expand {detail} for {subject}',
  'disclosure.collapse': 'Collapse {detail} for {subject}',
  'disclosure.pinned': '{detail} for {subject} (kept open while filtering)',
  'detail.description': 'description',
  'detail.tools': 'tools',
  'preset.nav': 'Agent Toolkit',
  'preset.title': 'Agent Toolkit',
  'preset.intro': 'Choose the default capabilities each agent preset starts from; sessions created or resumed afterward inherit it. The composer\'s Session context still changes only the current session.',
  'preset.projectSkill': 'this project',
  'preset.kindAria': 'Filter by category',
  'preset.readonly': 'Settings storage is read-only. You can inspect tools, but changes cannot be saved.',
  'preset.choose': 'Agent preset',
  'preset.empty': 'No agent presets are available.',
  'preset.noTools': 'This preset exposes no capabilities.',
  'preset.reserved': '{name} is a reserved transport and cannot be disabled.',
  'preset.broken': 'This preset cannot compose a session: {reason}. Fix it before its tools can be listed.',
};

/**
 * The slice of the host locale service this plugin uses. The full runtime
 * (dsh-client-locale) resolves the active locale per read and falls back to
 * `en` on a missing key, so a translate function is all the panel needs.
 */
export interface LocaleService {
  register(ns: string, locale: string, dict: Record<string, string>): () => void;
  bind(ns: string): (key: string, params?: Record<string, unknown>) => string;
  subscribe(fn: () => void): () => void;
  getSnapshot(): { readonly active: string; readonly revision: number };
}

export type Translate = (key: string, params?: Record<string, unknown>) => string;

/**
 * Register both dictionaries as one effect: the single-locale form is the
 * documented entry for namespaces outside the host's compile-time merge
 * table, and the returned disposers release both on unload.
 */
export function registerLocale(locale: LocaleService): () => void {
  const disposeZh = locale.register(LOCALE_NS, 'zh', zh);
  const disposeEn = locale.register(LOCALE_NS, 'en', en);
  return () => {
    disposeZh();
    disposeEn();
  };
}
