import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { aggregateBlocked } from '../stats.js';
import type { StatsRecord } from '../stats.js';

export interface StatsSnapshot {
  readonly records: StatsRecord[];
  readonly blocked: Record<string, number>;
  readonly warnings: string[];
}

export interface StatsStore {
  readonly file: string;
  read(): StatsSnapshot;
  append(record: StatsRecord): string | null;
}

export function statsFilePath(environment: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return join(environment['DSH_HOME'] ?? join(home, '.dsh'), 'capability-panel', 'stats.jsonl');
}

function isEnoent(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

export function createStatsStore(file = statsFilePath()): StatsStore {
  const appendWarnings: string[] = [];
  return {
    file,
    read() {
      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch (error) {
        if (isEnoent(error)) return { records: [], blocked: {}, warnings: [...appendWarnings] };
        return {
          records: [],
          blocked: {},
          warnings: [`stats read failed: ${String(error)}`, ...appendWarnings],
        };
      }
      const records: StatsRecord[] = [];
      const warnings: string[] = [...appendWarnings];
      const validLines: string[] = [];
      for (const [index, line] of text.split('\n').entries()) {
        if (line.trim() === '') continue;
        try {
          const parsed = JSON.parse(line) as StatsRecord;
          records.push(parsed);
          validLines.push(line);
        } catch (error) {
          warnings.push(`stats line ${index + 1} skipped: ${String(error)}`);
        }
      }
      return { records, blocked: aggregateBlocked(validLines), warnings };
    },
    append(record) {
      try {
        mkdirSync(dirname(file), { recursive: true });
        appendFileSync(file, `${JSON.stringify(record)}\n`);
        return null;
      } catch (error) {
        const warning = `stats append failed: ${String(error)}`;
        appendWarnings.push(warning);
        return warning;
      }
    },
  };
}
