import type {
  AnalyticsMemoryRecord,
  AnalyticsSessionListItem,
  AnalyticsSessionRecord,
  AnalyticsSessionTimeline,
  AnalyticsSummaryRecord,
  AnalyticsConversationTurnRecord,
  SessionRecapPayload,
} from './analyticsTypes';

export const LOCAL_ANALYTICS_HISTORY_STORAGE_KEY = 'browserbud.localAnalyticsHistory.v1';
const MAX_STORED_SESSIONS = 25;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type LocalRecapInput = {
  session: AnalyticsSessionRecord;
  turns: AnalyticsConversationTurnRecord[];
  memories: AnalyticsMemoryRecord[];
  createdAt?: string;
};

function cleanField(value?: string | null): string {
  return (value || '').trim();
}

function safeJsonParse(raw: string | null | undefined): unknown {
  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function hasSessionTimelineShape(value: unknown): value is AnalyticsSessionTimeline {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const timeline = value as Partial<AnalyticsSessionTimeline>;
  return Boolean(
    timeline.session
    && typeof timeline.session.id === 'string'
    && typeof timeline.session.startedAt === 'string'
    && Array.isArray(timeline.events)
    && Array.isArray(timeline.turns)
    && Array.isArray(timeline.memories)
    && Array.isArray(timeline.summaries),
  );
}

function sortTimelinesNewestFirst(left: AnalyticsSessionTimeline, right: AnalyticsSessionTimeline) {
  return right.session.startedAt.localeCompare(left.session.startedAt);
}

function getLatestSummary(timeline: AnalyticsSessionTimeline): AnalyticsSummaryRecord | null {
  return timeline.summaries[0] || null;
}

export function readStoredAnalyticsTimelines(storage: StorageLike | null | undefined): AnalyticsSessionTimeline[] {
  if (!storage) {
    return [];
  }

  const parsed = safeJsonParse(storage.getItem(LOCAL_ANALYTICS_HISTORY_STORAGE_KEY));
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter(hasSessionTimelineShape).sort(sortTimelinesNewestFirst);
}

export function writeStoredAnalyticsTimelines(
  storage: StorageLike | null | undefined,
  timelines: AnalyticsSessionTimeline[],
) {
  if (!storage) {
    return;
  }

  if (timelines.length === 0) {
    storage.removeItem(LOCAL_ANALYTICS_HISTORY_STORAGE_KEY);
    return;
  }

  storage.setItem(
    LOCAL_ANALYTICS_HISTORY_STORAGE_KEY,
    JSON.stringify([...timelines].sort(sortTimelinesNewestFirst).slice(0, MAX_STORED_SESSIONS)),
  );
}

export function upsertStoredAnalyticsTimeline(
  storage: StorageLike | null | undefined,
  timeline: AnalyticsSessionTimeline,
) {
  const existing = readStoredAnalyticsTimelines(storage).filter((entry) => entry.session.id !== timeline.session.id);
  writeStoredAnalyticsTimelines(storage, [timeline, ...existing]);
}

export function listStoredAnalyticsSessions(
  storage: StorageLike | null | undefined,
  limit = 10,
): AnalyticsSessionListItem[] {
  return readStoredAnalyticsTimelines(storage)
    .slice(0, limit)
    .map((timeline) => ({
      session: timeline.session,
      latestSummary: getLatestSummary(timeline),
    }));
}

export function getStoredAnalyticsSessionTimeline(
  storage: StorageLike | null | undefined,
  sessionId: string,
): AnalyticsSessionTimeline | null {
  return readStoredAnalyticsTimelines(storage).find((timeline) => timeline.session.id === sessionId) || null;
}

export function getLatestStoredAnalyticsSessionTimeline(
  storage: StorageLike | null | undefined,
): AnalyticsSessionTimeline | null {
  return readStoredAnalyticsTimelines(storage)[0] || null;
}

export function buildLocalSessionRecapSummary(input: LocalRecapInput): AnalyticsSummaryRecord<SessionRecapPayload> {
  const createdAt = input.createdAt || new Date().toISOString();
  const memoryCounts = input.memories.reduce<Record<string, number>>((counts, memory) => {
    counts[memory.memoryType] = (counts[memory.memoryType] || 0) + 1;
    return counts;
  }, {});
  const turnCounts = input.turns.reduce<Record<string, number>>((counts, turn) => {
    counts[turn.role] = (counts[turn.role] || 0) + 1;
    return counts;
  }, {});
  const payload: SessionRecapPayload = {
    sessionId: input.session.id,
    startedAt: input.session.startedAt,
    endedAt: input.session.endedAt,
    domains: [],
    turnCounts,
    memoryCounts,
    topMemories: input.memories.slice(0, 3).map((memory) => ({
      memoryType: memory.memoryType,
      title: memory.title,
      bodyMd: memory.bodyMd,
    })),
    notableTurns: input.turns.slice(-4).map((turn) => ({
      role: turn.role,
      transcript: turn.transcript,
    })),
  };

  const recapLines = [
    '# Session Recap',
    '',
    `- **Started:** ${input.session.startedAt}`,
    `- **Ended:** ${input.session.endedAt || 'In progress'}`,
    `- **Turns captured:** ${input.turns.length}`,
    `- **Saved items:** ${input.memories.length}`,
  ];

  const helpfulMemory = input.memories.find((memory) => memory.memoryType === 'helpful_info');
  if (helpfulMemory) {
    recapLines.push('', '## Saved context', '', cleanField(helpfulMemory.bodyMd) || cleanField(helpfulMemory.title));
  }

  if (input.turns.length > 0) {
    recapLines.push('', '## Recent turns', '');
    for (const turn of input.turns.slice(-3)) {
      recapLines.push(`- **${turn.role}:** ${cleanField(turn.transcript)}`);
    }
  }

  return {
    id: `local-summary-${input.session.id}`,
    sessionId: input.session.id,
    periodType: 'session',
    periodStart: input.session.startedAt,
    periodEnd: input.session.endedAt || input.session.startedAt,
    summaryKind: 'session_recap',
    markdown: recapLines.join('\n'),
    jsonPayload: payload,
    modelName: 'browser-local',
    createdAt,
  };
}
