/**
 * The connection half of MCP visibility: which servers this host DECLARES,
 * and how to restart one on demand.
 *
 * The tool registry answers "which tools can the model call right now" — the
 * only truth the switches act on — but it says nothing about a server whose
 * local process is down. An on-demand server (IDA, dnSpy, msfrpcd; also the
 * mock server used in tests) is configured in the host composition yet
 * registers nothing while down. The loader entry is that missing half of the
 * truth: it is where the server is declared, and restarting it is exactly
 * what an HMR reload of that entry does.
 *
 * Nothing here polls. The MCP client already owns connection state and
 * retries on its own schedule; the panel only reads the declaration on demand
 * and restarts an entry when the user asks.
 */
import { HttpError } from './errors.js';
import type { HostServices, LoaderEntryLike } from './types.js';

const MCP_CLIENT_NAME = '@deepseek-ai/dsh-mcp-client';

function entryConfig(entry: LoaderEntryLike): Record<string, unknown> | undefined {
  const config = entry.options?.config;
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return undefined;
  return config as Record<string, unknown>;
}

function declaredServerName(entry: LoaderEntryLike): string | undefined {
  // The loader stores the plugin package name on `options.name` (the field it
  // imports and logs), NOT a top-level `name`. Reading the wrong one silently
  // matches nothing.
  if (entry.options?.name !== MCP_CLIENT_NAME) return undefined;
  const serverName = entryConfig(entry)?.['serverName'];
  return typeof serverName === 'string' && serverName !== '' ? serverName : undefined;
}

/**
 * Server names the host composition declares via `@deepseek-ai/dsh-mcp-client`
 * entries — connected or not. Matched by plugin name, not by the `serverName`
 * key: an unrelated entry carrying a same-named config key is not an MCP
 * server.
 */
export function readConfiguredMcpServers(ctx: HostServices): Set<string> {
  const servers = new Set<string>();
  // Non-strict: the loader may be mid-reload while the panel reads; a strict
  // get would report "nothing declared" for a tree that exists.
  const loader = ctx.get?.('loader', false);
  if (loader === undefined) return servers;
  try {
    for (const entry of loader.entries()) {
      // A deliberately disabled entry is not "no tools registered" — it is
      // off by config. Listing it would promise a reload that can only 409.
      if (entry.disabled === true) continue;
      const name = declaredServerName(entry);
      if (name !== undefined) servers.add(name);
    }
  } catch {
    // A tree mid-reload reports what it could walk; the panel degrades by
    // showing fewer servers rather than failing the page.
  }
  return servers;
}

function entryFor(ctx: HostServices, server: string): LoaderEntryLike | undefined {
  const loader = ctx.get?.('loader', false);
  if (loader === undefined) return undefined;
  try {
    for (const entry of loader.entries()) {
      if (declaredServerName(entry) === server) return entry;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Reload one declared MCP server's plugin instance: dispose its fiber, then
 * refresh the entry — the loader's own hot-swap pair. This is exactly a
 * manual HMR reload: it tears down the current connection (and stops its
 * reconnect timer) and re-initializes the client, which reconnects and re-syncs
 * the whole tool generation.
 *
 * Honest scope of what this guarantees: only that a fresh connection attempt
 * starts NOW instead of waiting out the client's backoff. It does NOT prove
 * the server was "down" (the panel cannot observe connection state), and for a
 * stdio transport the reload respawns the child process. Registration lands
 * asynchronously after refresh resolves; the registry's `tools/change`
 * broadcast re-applies stored defaults, so callers need no readiness wait.
 *
 * Assumes a globally unique serverName: the settings view is host-global, and
 * dsh reserves one serverName per global mcp-client instance, so at most one
 * entry matches here. Agent-scoped instances may reuse a name across Agents,
 * but those are not reachable from this global walk.
 */
export async function restartMcpServer(ctx: HostServices, server: string): Promise<void> {
  const entry = entryFor(ctx, server);
  if (entry === undefined) throw new HttpError(404, `MCP server "${server}" is not configured on this host`);
  if (entry.disabled === true) {
    throw new HttpError(409, `MCP server "${server}" is disabled in the host composition; enable it there instead of reloading it`);
  }
  await entry._dispose();
  await entry.refresh();
}
