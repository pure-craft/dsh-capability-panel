/**
 * The loopback guard decides whether a caller may read this session's data, so
 * every branch here is a security decision. The fallback paths matter most:
 * they run exactly when the trustworthy evidence (the peer address) is absent,
 * which is also when a forged header would do the most damage.
 */
import { describe, expect, it } from 'vitest';
import { LOOPBACK_ADDRS, isLoopback } from '../src/loopback.js';

/** Build a request with no socket, so header fallback decides the verdict. */
function headersOnly(headers: Record<string, string | string[] | undefined>) {
  return { headers };
}

describe('peer address, the trustworthy evidence', () => {
  it('accepts every address in the loopback set', () => {
    for (const addr of LOOPBACK_ADDRS) {
      expect(isLoopback({ headers: {}, socket: { remoteAddress: addr } })).toBe(true);
    }
  });

  it('rejects a remote peer even when the headers claim localhost', () => {
    const forged = {
      headers: { host: '127.0.0.1:3080', origin: 'http://localhost:3080' },
      socket: { remoteAddress: '203.0.113.7' },
    };
    expect(isLoopback(forged)).toBe(false);
  });

  it('rejects a LAN peer, the case that makes the peer address load-bearing', () => {
    expect(isLoopback({ headers: {}, socket: { remoteAddress: '192.168.1.42' } })).toBe(false);
  });

  it('falls through to headers when the socket carries no address', () => {
    // socket present but remoteAddress absent: `typeof addr === 'string'` is
    // false, so the decision must continue rather than accept a blank peer.
    expect(isLoopback({ headers: { host: 'localhost' }, socket: {} })).toBe(true);
    expect(isLoopback({ headers: { host: 'evil.test' }, socket: {} })).toBe(false);
  });
});

describe('origin fallback', () => {
  it('accepts loopback origins over either scheme, with or without a port', () => {
    for (const origin of [
      'http://127.0.0.1:3080',
      'https://127.0.0.1',
      'http://localhost:5173',
      'https://localhost',
      'http://[::1]:3080',
      'https://[::1]',
    ]) {
      expect(isLoopback(headersOnly({ origin }))).toBe(true);
    }
  });

  it('rejects a non-loopback origin', () => {
    expect(isLoopback(headersOnly({ origin: 'https://evil.test' }))).toBe(false);
  });

  it('rejects a host that merely embeds a loopback name', () => {
    // Anchoring matters: an unanchored pattern would accept both of these.
    expect(isLoopback(headersOnly({ origin: 'http://localhost.evil.test' }))).toBe(false);
    expect(isLoopback(headersOnly({ origin: 'http://evil.test/127.0.0.1' }))).toBe(false);
  });

  it('rejects a non-http scheme pointing at loopback', () => {
    expect(isLoopback(headersOnly({ origin: 'ftp://127.0.0.1' }))).toBe(false);
  });

  it('ignores an array-valued origin and moves on to the host header', () => {
    // A duplicated header arrives as an array; it is not a string, so the
    // origin is treated as absent rather than coerced.
    const req = headersOnly({ origin: ['http://127.0.0.1'], host: 'localhost' });
    expect(isLoopback(req)).toBe(true);
  });
});

describe('host fallback, used only when no origin is present', () => {
  it('accepts the loopback host forms', () => {
    for (const host of ['127.0.0.1', '127.0.0.1:3080', 'localhost', 'localhost:5173', '[::1]', '[::1]:3080']) {
      expect(isLoopback(headersOnly({ host }))).toBe(true);
    }
  });

  it('rejects a remote host', () => {
    expect(isLoopback(headersOnly({ host: 'evil.test' }))).toBe(false);
  });

  it('rejects an array-valued host', () => {
    expect(isLoopback(headersOnly({ host: ['localhost'] }))).toBe(false);
  });

  it('fails closed when neither socket nor headers say anything', () => {
    expect(isLoopback(headersOnly({}))).toBe(false);
  });
});
