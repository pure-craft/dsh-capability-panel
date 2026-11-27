import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { readRequestBody } from '../src/host/route.js';

describe('request body terminal events', () => {
  it('keeps the first failure when an oversized body is followed by a stream error', async () => {
    const events = new EventEmitter();
    const pending = readRequestBody({ headers: {}, on: (name, listener) => { events.on(name, listener); } });
    const rejected = expect(pending).rejects.toMatchObject({ status: 413, message: 'request body too large' });
    events.emit('data', 'x'.repeat(16_385));
    events.emit('error', new Error('late socket failure'));
    events.emit('end');
    await rejected;
  });
});
