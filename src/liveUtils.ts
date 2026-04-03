import type { AnalyticsMemoryRecord, AnalyticsSessionTimeline, AnalyticsSummaryRecord } from './analyticsTypes';

export type ActivityLogEntryInput = {
  appName?: string;
  pageTitle?: string;
  url?: string;
  summary?: string;
  details?: string;
};

export type PersistedLogEntry = {
  id: string;
  timestamp: string;
  text: string;
  role: 'user' | 'model' | 'system';
};

export type TimedBackgroundSaveInput = {
  frequencyMs: number;
  nowMs: number;
  isModelSpeaking: boolean;
  hasPendingTurn: boolean;
  hasPendingToolCall: boolean;
  hasReconnectTimer: boolean;
  lastUserActivityAtMs: number;
  lastPromptAtMs: number;
  cooldownMs: number;
};

export type UserTranscriptCommitInput = {
  inputFinished: boolean;
  hasModelParts: boolean;
  hasToolCall: boolean;
  turnComplete: boolean;
  interrupted: boolean;
};

export type RehydratedSessionState = {
  sessionId: string | null;
  logs: PersistedLogEntry[];
  helpfulInfo: string;
  activityLog: string;
  savedNotes: string;
};

function cleanField(value?: string | null): string {
  return (value || '').trim();
}

function formatCreatedTime(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return 'Saved';
  }
  return parsed.toLocaleTimeString();
}

function sortNewestFirst(left: { createdAt?: string; startedAt?: string; endedAt?: string }, right: { createdAt?: string; startedAt?: string; endedAt?: string }) {
  const leftTimestamp = left.createdAt || left.endedAt || left.startedAt || '';
  const rightTimestamp = right.createdAt || right.endedAt || right.startedAt || '';
  return rightTimestamp.localeCompare(leftTimestamp);
}

function formatHelpfulInfoMemory(memory: AnalyticsMemoryRecord): string {
  const title = cleanField(memory.title) || 'Helpful Info';
  const body = cleanField(memory.bodyMd);
  if (!body) {
    return '';
  }
  return `### [${formatCreatedTime(memory.createdAt)}] ${title}\n\n${body}\n\n---\n\n`;
}

function formatSavedNoteMemory(memory: AnalyticsMemoryRecord): string {
  const note = cleanField(memory.bodyMd) || cleanField(memory.title);
  if (!note) {
    return '';
  }
  return `- **[${formatCreatedTime(memory.createdAt)}]** ${note}\n`;
}

function formatSummaryAsHelpfulInfo(summary: AnalyticsSummaryRecord): string {
  const recapBody = summary.markdown.replace(/^# Session Recap\s*/i, '').trim();
  if (!recapBody) {
    return '';
  }
  return `### [${formatCreatedTime(summary.createdAt)}] Session Recap\n\n${recapBody}\n\n---\n\n`;
}

export function formatActivityLogEntry(entry: ActivityLogEntryInput, timestamp: string): string {
  const appName = cleanField(entry.appName) || 'Unknown app';
  const summary = cleanField(entry.summary) || cleanField(entry.details) || 'Activity recorded';
  const pageTitle = cleanField(entry.pageTitle);
  const url = cleanField(entry.url);
  const details = cleanField(entry.details);

  const lines = [
    `### [${timestamp}] ${summary}`,
    '',
    `- **App:** ${appName}`,
  ];

  if (pageTitle) {
    lines.push(`- **Page:** ${pageTitle}`);
  }

  if (url) {
    lines.push(`- **URL:** <${url}>`);
  }

  if (details) {
    lines.push(`- **Details:** ${details}`);
  }

  lines.push('', '---', '');
  return `${lines.join('\n')}\n`;
}

export function serializeLogEntries(entries: PersistedLogEntry[]): string {
  return JSON.stringify(entries);
}

export function parseStoredLogEntries(raw: string | null | undefined): PersistedLogEntry[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') {
        return [];
      }

      const id = typeof entry.id === 'string' ? entry.id : null;
      const timestamp = typeof entry.timestamp === 'string' ? entry.timestamp : null;
      const text = typeof entry.text === 'string' ? entry.text : null;
      const role = entry.role;

      if (!id || !timestamp || !text || (role !== 'user' && role !== 'model' && role !== 'system')) {
        return [];
      }

      return [{ id, timestamp, text, role }];
    });
  } catch {
    return [];
  }
}

export function shouldRunTimedBackgroundSave(input: TimedBackgroundSaveInput): boolean {
  if (input.frequencyMs <= 0) {
    return false;
  }

  if (input.isModelSpeaking || input.hasPendingTurn || input.hasPendingToolCall || input.hasReconnectTimer) {
    return false;
  }

  if (input.nowMs - input.lastUserActivityAtMs < input.cooldownMs) {
    return false;
  }

  if (input.nowMs - input.lastPromptAtMs < input.cooldownMs) {
    return false;
  }

  return true;
}

export function shouldCommitUserTranscript(input: UserTranscriptCommitInput): boolean {
  if (input.inputFinished) {
    return true;
  }

  if (input.hasModelParts || input.hasToolCall) {
    return true;
  }

  if (input.turnComplete || input.interrupted) {
    return true;
  }

  return false;
}

export function buildTimedHelpfulInfoPrompt(): string {
  return [
    'Background auto-save check.',
    'Do not speak aloud unless there is an urgent warning.',
    'Call appendHelpfulInfo exactly once in this turn.',
    'Save a concise markdown note about what the user is looking at, doing, or deciding right now.',
    'Include practical context, key takeaways, and anything worth remembering later.',
    'If very little changed, still save a short progress update instead of skipping the tool call.',
    'Do not ask follow-up questions.',
    'Keep any spoken reply extremely brief or silent unless there is an urgent warning.',
  ].join(' ');
}

export function buildRehydratedSessionState(timeline: AnalyticsSessionTimeline): RehydratedSessionState {
  const logs = [...timeline.turns]
    .sort(sortNewestFirst)
    .flatMap((turn) => {
      if (turn.role !== 'user' && turn.role !== 'model') {
        return [];
      }

      const text = cleanField(turn.transcript);
      const timestamp = turn.endedAt || turn.startedAt;
      if (!text || !timestamp) {
        return [];
      }

      return [{
        id: turn.id,
        timestamp,
        text,
        role: turn.role,
      }] satisfies PersistedLogEntry[];
    });

  const helpfulInfo = [
    ...timeline.summaries
      .filter((summary) => summary.summaryKind === 'session_recap')
      .sort(sortNewestFirst)
      .map(formatSummaryAsHelpfulInfo),
    ...timeline.memories
      .filter((memory) => memory.memoryType === 'helpful_info')
      .sort(sortNewestFirst)
      .map(formatHelpfulInfoMemory),
  ].join('');

  const activityLog = timeline.memories
    .filter((memory) => memory.memoryType === 'activity_log')
    .sort(sortNewestFirst)
    .map((memory) => {
      const body = memory.bodyMd.trim();
      if (!body) {
        return '';
      }
      return body.endsWith('\n') ? body : `${body}\n`;
    })
    .join('');

  const savedNotes = timeline.memories
    .filter((memory) => memory.memoryType === 'saved_note')
    .sort(sortNewestFirst)
    .map(formatSavedNoteMemory)
    .join('');

  return {
    sessionId: timeline.session.id,
    logs,
    helpfulInfo,
    activityLog,
    savedNotes,
  };
}

export function mergeIncrementalTranscript(existing: string, incoming?: string): string {
  if (!incoming) {
    return existing;
  }
  if (!existing) {
    return incoming;
  }
  if (incoming === existing || existing.endsWith(incoming)) {
    return existing;
  }
  if (incoming.startsWith(existing)) {
    return incoming;
  }
  if (existing.startsWith(incoming)) {
    return existing;
  }
  if (existing.includes(incoming)) {
    return existing;
  }

  const maxOverlap = Math.min(existing.length, incoming.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (existing.slice(-overlap) === incoming.slice(0, overlap)) {
      return existing + incoming.slice(overlap);
    }
  }

  return existing + incoming;
}

export function truncateSessionHandle(handle: string | null | undefined, visibleChars = 8): string {
  if (!handle) {
    return 'Waiting for handle';
  }
  if (handle.length <= visibleChars * 2) {
    return handle;
  }
  return `${handle.slice(0, visibleChars)}...${handle.slice(-visibleChars)}`;
}

export function formatLatency(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return 'Waiting';
  }
  return `${Math.round(value)} ms`;
}
