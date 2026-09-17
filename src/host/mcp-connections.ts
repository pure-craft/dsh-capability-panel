/**
 * The connection half of the panel: which MCP servers this host declares, and
 * how to restart one on demand.
 *
 * The registry (`tools.schemas()`) answers "which tools does the model see right
 * now", which is the only truth the switches act on — but it answers nothing
 * about a server whose local process is not running. An on-demand server (a
 * local IDA, dnSpy or msfrpcd) is the normal case for those: configured in the
 * host composition, connected only while its service is up. The loader entry is
 * that missing half: it is where the server is declared, and restarting it is
 * exactly what an HMR reload of that entry does.
 *
 * Nothing here polls. The MCP client owns connection state and retries on its
 * own schedule; the panel reads the declaration on demand and restarts an entry
 * when the user asks.
 */
import { groupMcpTools } from '../load-state.js';
import { HttpError } from './errors.js';
import type { HostServices, LoaderEntryLike, LoaderLike } from './types.js';

/**
 * The one plugin whose loader entries are MCP servers. The plugin name is part
 * of the test on purpose: a `serverName`-shaped key in some other plugin's
 * config is not an MCP server, and treating one as such would invent rows the
 * host never declared.
 */
const MCP_CLIENT_PLUGIN = '@deepseek-ai/dsh-mcp-client';

/** One MCP server the host declares, whether or not it is currently connected. */
export interface ConfiguredMcpServer {
  /** The `serverName` this host declares; also the `mcp__<name>__` namespace. */
  readonly server: string;
}

function pluginConfig(entry: LoaderEntryLike): Record<string, unknown> | undefined {
  const config = entry.options?.config;
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return undefined;
  return config as Record<string, unknown>;
}

/** The server one loader entry declares, or undefined when it declares none. */
function declaredServer(entry: LoaderEntryLike): string | undefined {
  if (entry.options?.name !== MCP_CLIENT_PLUGIN) return undefined;
  const name = pluginConfig(entry)?.['serverName'];
  return typeof name === 'string' && name !== '' ? name : undefined;
}

function loaderOf(ctx: HostServices): LoaderLike | undefined {
  try {
    return ctx.get('loader');
  } catch {
    return undefined;
  }
}

/** Server names the host composition declares, connected or not. */
export function readConfiguredMcpServers(ctx: HostServices): Map<string, ConfiguredMcpServer> {
  const servers = new Map<string, ConfiguredMcpServer>();
  const loader = loaderOf(ctx);
  if (loader === undefined) return servers;
  try {
    for (const entry of loader.entries()) {
      const server = declaredServer(entry);
      if (server === undefined || servers.has(server)) continue;
      servers.set(server, { server });
    }
  } catch {
    // A tree mid-reload reports what it could walk; the panel degrades by
    // showing fewer servers rather than by failing the whole page.
  }
  return servers;
}

/** Server names currently carrying at least one registered tool. */
export function readRegisteredMcpServers(ctx: HostServices): Set<string> {
  const servers = new Set<string>();
  const tools = ctx.get('tools');
  if (tools === undefined) return servers;
  try {
    const names: string[] = [];
    for (const schema of tools.schemas()) {
      if (typeof schema.name === 'string' && schema.name.startsWith('mcp__')) names.push(schema.name);
    }
    for (const group of groupMcpTools(names)) servers.add(group.server);
  } catch {
    // Same degradation as above: an unreadable registry reads as "none".
  }
  return servers;
}

function entryFor(ctx: HostServices, server: string): LoaderEntryLike | undefined {
  const loader = loaderOf(ctx);
  if (loader === undefined) return undefined;
  try {
    for (const entry of loader.entries()) {
      if (declaredServer(entry) === server) return entry;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Restart one MCP server's plugin instance and report how many tools it
 * registered. Disposal closes the live connection (and stops its reconnect
 * timer); refresh re-imports and re-applies the entry, which connects again and
 * re-syncs the whole tool generation.
 *
 * Re-applying stored defaults to whatever the restart registers is deliberately
 * not this function's job: the registry broadcasts every layer change and the
 * capability controller re-masks from that, so the only promise here is that the
 * connection is up again now, instead of after the client's backoff.
 */
export async function restartMcpServer(ctx: HostServices, server: string): Promise<number> {
  const entry = entryFor(ctx, server);
  if (entry === undefined) throw new HttpError(404, `MCP server "${server}" is not configured on this host`);
  if (entry.disabled === true) {
    throw new HttpError(409, `MCP server "${server}" is disabled in the host composition; enable it in the host config instead of reconnecting`);
  }
  await entry._dispose();
  await entry.refresh();
  const prefix = `mcp__${server}__`;
  const tools = ctx.get('tools');
  if (tools === undefined) return 0;
  let registered = 0;
  try {
    for (const schema of tools.schemas()) {
      if (typeof schema.name === 'string' && schema.name.startsWith(prefix)) registered += 1;
    }
  } catch {
    return 0;
  }
  return registered;
}
