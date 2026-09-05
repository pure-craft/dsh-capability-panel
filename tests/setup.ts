/**
 * Isolate the append-only stats log per test FILE.
 *
 * `statsFilePath` resolves through DSH_HOME, and several integration tests
 * exercise real POST toggles whose side effect is an append to that log.
 * Without isolation a test run writes into the user's real
 * ~/.dsh/capability-panel/stats.jsonl — polluting the panel's blocked counts and
 * making count assertions flaky across runs. setupFiles execute once per test
 * file's module graph, so each file gets its own empty home; tests that set
 * DSH_HOME explicitly still override this per case.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from 'node:process';

env['DSH_HOME'] = mkdtempSync(join(tmpdir(), 'dsh-capability-panel-test-'));
