/** The minimal readable surface of a request object inside a route handler. */
export interface IncomingLike {
  readonly url?: string;
  readonly method?: string;
  readonly headers: Record<string, string | string[] | undefined>;
  /**
   * Present on node's http.IncomingMessage. Prefer it for the loopback
   * decision: the Host and Origin headers are client-controlled and forgeable.
   */
  readonly socket?: { readonly remoteAddress?: string };
}

export const LOOPBACK_ADDRS: ReadonlySet<string> = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Loopback-only guard.
 *
 * The connection's peer address is the only trustworthy evidence, and it is the
 * only one that still holds when the host binds to a LAN interface
 * (`--host` / `--trusted-host`). The Host and Origin headers are set by the
 * caller, so they are a fallback used only when the socket is unavailable —
 * with neither present, this fails closed.
 */
export function isLoopback(req: IncomingLike): boolean {
  const addr = req.socket?.remoteAddress;
  if (typeof addr === 'string') return LOOPBACK_ADDRS.has(addr);
  const originHeader = req.headers['origin'];
  const origin = typeof originHeader === 'string' ? originHeader : '';
  if (origin === '') {
    const hostHeader = req.headers['host'];
    const host = typeof hostHeader === 'string' ? hostHeader : '';
    return /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host);
  }
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin);
}
