export type AnalyticsSessionRecord = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  sourceSurface: string | null;
  personaId: string | null;
  liveModel: string | null;
  searchEnabled: boolean;
  captureMode: string;
  createdAt: string;
};

export type AnalyticsSessionCreateInput = {
  id?: string;
  startedAt: string;
  sourceSurface?: string | null;
  personaId?: string | null;
  liveModel?: string | null;
  searchEnabled?: boolean;
  captureMode: string;
};

export type AnalyticsRawEventRecord = {
  id: string;
  sessionId: string;
  seq: number;
  source: string;
  eventType: string;
  occurredAt: string;
  endedAt: string | null;
  appName: string | null;
  windowTitle: string | null;
  tabId: string | null;
  url: string | null;
  domain: string | null;
  pageTitle: string | null;
  payload: Record<string, unknown>;
  privacyTier: string;
};

export type AnalyticsRawEventInput = {
  id?: string;
  sessionId: string;
  seq: number;
  source: string;
  eventType: string;
  occurredAt: string;
  endedAt?: string | null;
  appName?: string | null;
  windowTitle?: string | null;
  tabId?: string | null;
  url?: string | null;
  domain?: string | null;
  pageTitle?: string | null;
  payload?: Record<string, unknown>;
  privacyTier?: string;
};

export type AnalyticsConversationTurnRecord = {
  id: string;
  sessionId: string;
  role: string;
  startedAt: string;
  endedAt: string | null;
  transcript: string;
  promptKind: string | null;
  modelName: string | null;
  relatedEventId: string | null;
};

export type AnalyticsConversationTurnInput = {
  id?: string;
  sessionId: string;
  role: string;
  startedAt: string;
  endedAt?: string | null;
  transcript: string;
  promptKind?: string | null;
  modelName?: string | null;
  relatedEventId?: string | null;
};

export type AnalyticsMemoryRecord = {
  id: string;
  sessionId: string;
  memoryType: string;
  title: string;
  bodyMd: string;
  sourceUrl: string | null;
  sourceEventIds: string[];
  sourceTurnIds: string[];
  embeddingModel: string | null;
  embeddingJson: string | null;
  createdAt: string;
};

export type AnalyticsMemoryInput = {
  id?: string;
  sessionId: string;
  memoryType: string;
  title: string;
  bodyMd: string;
  sourceUrl?: string | null;
  sourceEventIds?: string[];
  sourceTurnIds?: string[];
  embeddingModel?: string | null;
  embeddingJson?: string | null;
};

export type AnalyticsSummaryRecord<TPayload = Record<string, unknown>> = {
  id: string;
  sessionId: string | null;
  periodType: string;
  periodStart: string;
  periodEnd: string;
  summaryKind: string;
  markdown: string;
  jsonPayload: TPayload;
  modelName: string;
  createdAt: string;
};

export type AnalyticsSessionListItem = {
  session: AnalyticsSessionRecord;
  latestSummary: AnalyticsSummaryRecord | null;
};

export type SessionRecapPayload = {
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
  domains: Array<{
    domain: string;
    eventCount: number;
    pageTitles: string[];
  }>;
  turnCounts: Record<string, number>;
  memoryCounts: Record<string, number>;
  topMemories: Array<{
    memoryType: string;
    title: string;
    bodyMd: string;
  }>;
  notableTurns: Array<{
    role: string;
    transcript: string;
  }>;
};

export type AnalyticsSessionTimeline = {
  session: AnalyticsSessionRecord;
  events: AnalyticsRawEventRecord[];
  turns: AnalyticsConversationTurnRecord[];
  memories: AnalyticsMemoryRecord[];
  summaries: AnalyticsSummaryRecord[];
};
