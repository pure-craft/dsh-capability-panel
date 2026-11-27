import { z } from 'zod';
import { insightsStateSchema } from './insights-fold.js';
import type { InsightsContext } from './insights.js';
const storedSchema = z.object({ header: z.string(), state: insightsStateSchema, next: z.number().int().nonnegative() });
export type StoredInsights = z.infer<typeof storedSchema>;
interface Domain {
  table(name: string): { get(key: string): StoredInsights | undefined; put(key: string, value: StoredInsights): Promise<void> };
  close(): Promise<void>;
}
interface Facility { open(spec: unknown): Promise<Domain> }
export function createInsightsStore(ctx: InsightsContext) {
  let opening: Promise<Domain | undefined> | undefined;
  const open = (): Promise<Domain | undefined> => {
    const facility = ctx.get('storageDomain', false) as Facility | undefined;
    if (facility === undefined) return Promise.resolve(undefined);
    opening ??= facility.open({ name: 'capability_panel_insights', version: 1, layout: 'per-record',
      invalidRecords: 'backup-and-skip', tables: { sessions: { valueSchema: storedSchema } } });
    return opening;
  };
  return {
    async get(id: string): Promise<StoredInsights | undefined> { return (await open())?.table('sessions').get(id); },
    async put(id: string, value: StoredInsights): Promise<void> { await (await open())?.table('sessions').put(id, value); },
    async close(): Promise<void> { await (await opening)?.close(); },
  };
}
