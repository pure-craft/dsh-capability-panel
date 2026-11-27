/** Usage metadata only; no tool arguments or result bodies cross this boundary. */
export interface InsightUsage {
  readonly name: string;
  readonly count: number;
  readonly lastUsed: number | null;
}
export interface InsightPreset {
  readonly presetId: string | null;
  readonly sessions: number;
  readonly toolCalls: number;
  readonly skillCalls: number;
  readonly lastUsed: number | null;
}
export interface InsightsPayload {
  readonly scope: 'workspace' | 'global';
  readonly cwd: string | null;
  readonly presetId: string | null;
  readonly coverage: {
    readonly knownSessions: number;
    readonly indexedSessions: number;
    readonly complete: boolean;
    readonly unknown: boolean;
  };
  readonly tools: readonly InsightUsage[];
  readonly skills: readonly InsightUsage[];
  readonly presets: readonly InsightPreset[];
  readonly warnings: readonly string[];
}
export interface InsightsQuery {
  readonly sessionId?: string;
  readonly scope: 'workspace' | 'global';
  readonly presetId?: string;
}
export interface InsightsBackfillResult {
  readonly processedSessions: number;
  readonly remainingSessions: number;
  readonly warnings: readonly string[];
}
