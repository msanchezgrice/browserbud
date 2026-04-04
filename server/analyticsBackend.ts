import type {
  AnalyticsConversationTurnInput,
  AnalyticsConversationTurnRecord,
  AnalyticsMemoryInput,
  AnalyticsMemoryRecord,
  AnalyticsRawEventInput,
  AnalyticsRawEventRecord,
  AnalyticsSessionCreateInput,
  AnalyticsSessionListItem,
  AnalyticsSessionRecord,
  AnalyticsSessionTimeline,
  AnalyticsSummaryRecord,
  SessionRecapPayload,
} from '../src/analyticsTypes';

export type MaybePromise<T> = T | Promise<T>;

export interface AnalyticsStoreAdapter {
  initialize(): MaybePromise<void>;
  close(): MaybePromise<void>;
  createSession(input: AnalyticsSessionCreateInput): MaybePromise<AnalyticsSessionRecord>;
  getSession(sessionId: string): MaybePromise<AnalyticsSessionRecord>;
  completeSession(sessionId: string, endedAt: string): MaybePromise<AnalyticsSessionRecord>;
  appendRawEvent(input: AnalyticsRawEventInput): MaybePromise<AnalyticsRawEventRecord>;
  saveConversationTurn(input: AnalyticsConversationTurnInput): MaybePromise<AnalyticsConversationTurnRecord>;
  saveMemory(input: AnalyticsMemoryInput): MaybePromise<AnalyticsMemoryRecord>;
  listSessionTimeline(sessionId: string): MaybePromise<AnalyticsSessionTimeline>;
  listRecentSessions(limit?: number): MaybePromise<AnalyticsSessionListItem[]>;
  getLatestSessionTimeline(): MaybePromise<AnalyticsSessionTimeline>;
  generateSessionRecap(sessionId: string): MaybePromise<AnalyticsSummaryRecord<SessionRecapPayload>>;
}

export class AnalyticsBackendUnavailableError extends Error {
  readonly status = 503;

  constructor(message = 'Shared analytics backend is not configured.') {
    super(message);
    this.name = 'AnalyticsBackendUnavailableError';
  }
}
