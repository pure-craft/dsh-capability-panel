import { isLoopback } from '../loopback.js';
import { buildPayload, EMPTY_STATE, parentDir } from './catalog.js';
import type { CapabilityController } from './capabilities.js';
import { errorMessage, HttpError } from './errors.js';
import { openFolder } from './open-folder.js';
import type { PresetToolController } from './preset-tools.js';
import type { SessionOverrideStore } from './session-overrides.js';
import type { StatsStore } from './stats-store.js';
import type { CapabilityKind, HostServices, IncomingLike, ServerResponseLike } from './types.js';

export const ROUTE = '/api/capability-panel';
const KINDS: readonly CapabilityKind[] = ['skill', 'mcp-server', 'mcp-tool', 'system-tool'];

class ClientRequestError extends HttpError {
  constructor(message: string, status: 400 | 413 = 400) {
    super(status, message);
  }
}

export function readRequestBody(req: IncomingLike): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (req.on === undefined) {
      reject(new ClientRequestError('request body stream unavailable'));
      return;
    }
    let body = '';
    let settled = false;
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      reject(error instanceof ClientRequestError ? error : new Error(String(error)));
    };
    req.on('data', (chunk) => {
      if (settled) return;
      body += String(chunk);
      if (body.length > 16_384) fail(new ClientRequestError('request body too large', 413));
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        resolve(body === '' ? {} : JSON.parse(body));
      } catch {
        reject(new ClientRequestError('invalid JSON body'));
      }
    });
    req.on('error', fail);
  });
}

/**
 * Every response here reflects live process state, so `no-store` is the
 * default and opting out is explicit. The flag reads as what it does: the
 * previous spelling was `cache = true` on the ERROR branch, which left a
 * transient 503 as the only cacheable response the route produced.
 */
function json(res: ServerResponseLike, status: number, body: unknown, allowCaching = false): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...(allowCaching ? {} : { 'cache-control': 'no-store' }),
  });
  res.end(JSON.stringify(body));
}

/**
 * `kind` mirrors the session route's toggle shape: one tool, or a whole MCP
 * server in a single write.
 */
function validatePresetToggle(body: unknown): { presetId: string; kind: 'tool' | 'mcp-server' | 'skill'; name: string; enabled: boolean } {
  if (body === null || typeof body !== 'object') throw new ClientRequestError('invalid request body');
  const record = body as { presetId?: unknown; kind?: unknown; name?: unknown; enabled?: unknown };
  if (typeof record.presetId !== 'string' || record.presetId === '') throw new ClientRequestError('presetId is required');
  const kind = record.kind ?? 'tool';
  if (kind !== 'tool' && kind !== 'mcp-server' && kind !== 'skill') {
    throw new ClientRequestError('kind must be "tool", "mcp-server" or "skill"');
  }
  if (typeof record.name !== 'string' || record.name === '') throw new ClientRequestError('name is required');
  if (typeof record.enabled !== 'boolean') throw new ClientRequestError('enabled must be boolean');
  return { presetId: record.presetId, kind, name: record.name, enabled: record.enabled };
}

function validatePresetContentType(req: IncomingLike, res: ServerResponseLike): boolean {
  const contentType = req.headers['content-type'];
  if (typeof contentType === 'string' && contentType.startsWith('application/json')) return true;
  res.writeHead(415, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('expected application/json');
  return false;
}

function validateToggle(sessionId: string | null, body: unknown): { sessionId: string; kind: CapabilityKind; name: string; enabled: boolean } {
  if (sessionId === null) throw new ClientRequestError('session is required');
  if (body === null || typeof body !== 'object') throw new ClientRequestError('invalid request body');
  const record = body as { kind?: unknown; name?: unknown; enabled?: unknown };
  if (typeof record.kind !== 'string' || !KINDS.includes(record.kind as CapabilityKind) || typeof record.enabled !== 'boolean') {
    throw new ClientRequestError('kind must be skill, mcp-server, mcp-tool or system-tool and enabled must be boolean');
  }
  if (typeof record.name !== 'string' || record.name === '') throw new ClientRequestError('name is required');
  return { sessionId, kind: record.kind as CapabilityKind, name: record.name, enabled: record.enabled };
}

export function createRouteHandler(
  services: HostServices,
  capabilities: CapabilityController,
  stats: StatsStore,
  blockedCounts: Record<string, number>,
  presetTools: PresetToolController,
  sessionOverrides: SessionOverrideStore,
): (req: IncomingLike, res: ServerResponseLike) => Promise<void> {
  return async (req, res) => {
    if (!isLoopback(req)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('forbidden');
      return;
    }
    try {
      const url = new URL(req.url ?? '/', 'http://dsh.local');
      if (url.pathname === `${ROUTE}/presets`) {
        if (req.method !== 'GET' && req.method !== 'POST') {
          res.writeHead(405, { allow: 'GET, POST', 'content-type': 'text/plain; charset=utf-8' });
          res.end('method not allowed');
          return;
        }
        if (req.method === 'POST') {
          if (!validatePresetContentType(req, res)) return;
          const toggle = validatePresetToggle(await readRequestBody(req));
          json(res, 200, toggle.kind === 'skill'
            ? await presetTools.setSkill(toggle.presetId, toggle.name, toggle.enabled)
            : toggle.kind === 'mcp-server'
            ? await presetTools.setServer(toggle.presetId, toggle.name, toggle.enabled)
            : await presetTools.set(toggle.presetId, toggle.name, toggle.enabled));
          return;
        }
        json(res, 200, await presetTools.list());
        return;
      }
      if (url.pathname === `${ROUTE}/stats`) {
        if (req.method !== 'GET') {
          res.writeHead(405, { allow: 'GET', 'content-type': 'text/plain; charset=utf-8' });
          res.end('method not allowed');
          return;
        }
        const snapshot = stats.read();
        json(res, 200, { logFile: stats.file, blocked: blockedCounts, records: snapshot.records, ...(snapshot.warnings.length > 0 ? { warnings: snapshot.warnings } : {}) }, true);
        return;
      }
      if (url.pathname === `${ROUTE}/open-folder`) {
        if (req.method !== 'POST') {
          res.writeHead(405, { allow: 'POST', 'content-type': 'text/plain; charset=utf-8' });
          res.end('method not allowed');
          return;
        }
        if (!validatePresetContentType(req, res)) return;
        const body = await readRequestBody(req);
        if (body === null || typeof body !== 'object') {
          json(res, 400, { error: 'invalid request body' });
          return;
        }
        const record = body as { sessionId?: unknown; source?: unknown };
        if (typeof record.source !== 'string' || record.source === '') {
          json(res, 400, { error: 'source is required' });
          return;
        }
        const source = record.source;
        const sessionId = typeof record.sessionId === 'string' ? record.sessionId : null;
        let folderPath: string | undefined;
        // Authoritative path first: re-list the session's skills and take the
        // resourceBase directory of the first entry carrying this source. This
        // covers every source the filesystem provider knows — including
        // 'custom' (customSkillDirs) — without guessing paths.
        if (sessionId !== null) {
          try {
            const skills = services.get('skills');
            const agent = services.get('agents')?.get(sessionId);
            if (skills !== undefined && agent !== undefined) {
              const cwd = agent.session?.header?.cwd;
              const list = await skills.list({ ...(cwd === undefined ? {} : { cwd }), scope: agent });
              for (const item of list) {
                if (item.source !== source) continue;
                const base = item.resourceBase;
                if (base !== null && typeof base === 'object' && (base as { kind?: unknown }).kind === 'directory') {
                  const path = (base as { path?: unknown }).path;
                  if (typeof path === 'string' && path !== '') {
                    // resourceBase is the skill's own folder; the group folder
                    // is its parent (the source root).
                    folderPath = parentDir(path);
                    break;
                  }
                }
              }
            }
          } catch { /* listing failed — fall through to the heuristic */ }
        }
        // Heuristic fallbacks for sources with no live skill entry, and for
        // MCP sources (which are preset names or 'host').
        if (folderPath === undefined && (source === 'user-dsh' || source === 'user-agents')) {
          const dshHome = process.env['DSH_HOME'] ?? (process.env['HOME'] !== undefined ? `${process.env['HOME']}/.dsh` : undefined);
          if (dshHome !== undefined) {
            folderPath = source === 'user-dsh' ? `${dshHome}/skills` : `${process.env['DSH_AGENTS_HOME'] ?? `${process.env['HOME']}/.agents`}/skills`;
          }
        } else if (folderPath === undefined && (source === 'project-dsh' || source === 'project-agents')) {
          // Sessionless callers (the settings page) report project rows
          // against the dsh process's own cwd — resolve those the same way.
          const agent = sessionId === null ? undefined : services.get('agents')?.get(sessionId);
          const cwd = agent?.session?.header?.cwd ?? (sessionId === null ? process.cwd() : undefined);
          if (cwd !== undefined) {
            folderPath = source === 'project-dsh' ? `${cwd}/.dsh/skills` : `${cwd}/.agents/skills`;
          }
        } else if (folderPath === undefined && source === 'host') {
          // Host composition entries live under DSH_HOME — open the home.
          folderPath = process.env['DSH_HOME'] ?? (process.env['HOME'] !== undefined ? `${process.env['HOME']}/.dsh` : undefined);
        } else if (folderPath === undefined && source !== 'bundled' && source !== 'runtime') {
          // Anything else is a preset name — look up its path.
          try {
            const presets = await services.get('agentPresets')?.list();
            const preset = presets?.find((p) => p.id === source || p.name === source);
            if (preset !== undefined) folderPath = preset.path;
          } catch { /* preset lookup failed — leave folderPath undefined */ }
        }
        if (folderPath === undefined) {
          json(res, 404, { error: `cannot open folder for source "${source}"` });
          return;
        }
        try {
          await openFolder(folderPath);
          json(res, 200, { ok: true });
        } catch (error) {
          json(res, 500, { error: `failed to open folder: ${errorMessage(error)}` });
        }
        return;
      }
      // The catalogue answers the prefix itself, not everything beneath it.
      // Falling through meant /api/capability-panel/bogus returned the catalogue
      // with a 200, which hides a caller's typo and would silently change
      // meaning the day a real sub-path is added under that name. A request
      // whose url is absent is the degenerate case the prefix router can hand
      // down; it reads as the root, not as an unknown path.
      if (url.pathname !== ROUTE && url.pathname !== '/') {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
        res.end('not found');
        return;
      }
      if (req.method !== 'GET' && req.method !== 'POST') {
        res.writeHead(405, { allow: 'GET, POST', 'content-type': 'text/plain; charset=utf-8' });
        res.end('method not allowed');
        return;
      }
      const sessionId = url.searchParams.get('session');
      let persistNote: string | undefined;
      if (req.method === 'POST') {
        const contentType = req.headers['content-type'];
        if (typeof contentType !== 'string' || !contentType.startsWith('application/json')) {
          res.writeHead(415, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('expected application/json');
          return;
        }
        const toggle = validateToggle(sessionId, await readRequestBody(req));
        await capabilities.set(toggle.sessionId, toggle.kind, toggle.name, toggle.enabled);
        // The mask is live; persisting it for the session's next agent is
        // best-effort. A failed write must degrade the payload, not the
        // toggle the user already made.
        try {
          await sessionOverrides.record(toggle.sessionId, toggle.kind, toggle.name, toggle.enabled);
        } catch (error) {
          persistNote = `switch applied for this session but could not be persisted across a restart: ${errorMessage(error)}`;
        }
      }
      const payload = await buildPayload(
        services,
        sessionId,
        sessionId === null ? EMPTY_STATE : (capabilities.state(sessionId) ?? EMPTY_STATE),
        blockedCounts,
      );
      json(res, 200, persistNote === undefined
        ? payload
        : { ...payload, degraded: [...(payload.degraded ?? []), persistNote] });
    } catch (error) {
      json(res, error instanceof HttpError ? error.status : 500, { error: errorMessage(error) });
    }
  };
}
