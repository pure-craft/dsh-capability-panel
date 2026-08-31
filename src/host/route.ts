import { isLoopback } from '../loopback.js';
import { buildPayload, EMPTY_STATE } from './catalog.js';
import type { CapabilityController } from './capabilities.js';
import { errorMessage, HttpError } from './errors.js';
import type { PresetToolController } from './preset-tools.js';
import type { StatsStore } from './stats-store.js';
import type { CapabilityKind, HostServices, IncomingLike, ServerResponseLike } from './types.js';

export const ROUTE = '/api/agent-toolkit';
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

function json(res: ServerResponseLike, status: number, body: unknown, cache = false): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...(cache ? {} : { 'cache-control': 'no-store' }),
  });
  res.end(JSON.stringify(body));
}

function validatePresetToggle(body: unknown): { presetId: string; name: string; enabled: boolean } {
  if (body === null || typeof body !== 'object') throw new ClientRequestError('invalid request body');
  const record = body as { presetId?: unknown; name?: unknown; enabled?: unknown };
  if (typeof record.presetId !== 'string' || record.presetId === '') throw new ClientRequestError('presetId is required');
  if (typeof record.name !== 'string' || record.name === '') throw new ClientRequestError('name is required');
  if (typeof record.enabled !== 'boolean') throw new ClientRequestError('enabled must be boolean');
  return { presetId: record.presetId, name: record.name, enabled: record.enabled };
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
          json(res, 200, await presetTools.set(toggle.presetId, toggle.name, toggle.enabled));
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
      if (req.method !== 'GET' && req.method !== 'POST') {
        res.writeHead(405, { allow: 'GET, POST', 'content-type': 'text/plain; charset=utf-8' });
        res.end('method not allowed');
        return;
      }
      const sessionId = url.searchParams.get('session');
      if (req.method === 'POST') {
        const contentType = req.headers['content-type'];
        if (typeof contentType !== 'string' || !contentType.startsWith('application/json')) {
          res.writeHead(415, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('expected application/json');
          return;
        }
        const toggle = validateToggle(sessionId, await readRequestBody(req));
        await capabilities.set(toggle.sessionId, toggle.kind, toggle.name, toggle.enabled);
      }
      const payload = await buildPayload(
        services,
        sessionId,
        sessionId === null ? EMPTY_STATE : (capabilities.state(sessionId) ?? EMPTY_STATE),
        blockedCounts,
      );
      json(res, 200, payload);
    } catch (error) {
      json(res, error instanceof HttpError ? error.status : 500, { error: errorMessage(error) }, true);
    }
  };
}
