import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLocalSessionRecapSummary,
  getLatestStoredAnalyticsSessionTimeline,
  getStoredAnalyticsSessionTimeline,
  listStoredAnalyticsSessions,
  LOCAL_ANALYTICS_HISTORY_STORAGE_KEY,
  readStoredAnalyticsTimelines,
  upsertStoredAnalyticsTimeline,
} from '../src/localAnalyticsHistory';

function createStorage(seed?: string) {
  const storage = new Map<string, string>();
  if (seed) {
    storage.set(LOCAL_ANALYTICS_HISTORY_STORAGE_KEY, seed);
  }

  return {
    getItem(key: string) {
      return storage.has(key) ? storage.get(key)! : null;
    },
    setItem(key: string, value: string) {
      storage.set(key, value);
    },
    removeItem(key: string) {
      storage.delete(key);
    },
  };
}

test('readStoredAnalyticsTimelines ignores malformed storage data', () => {
  const storage = createStorage('{"oops":true}');
  assert.deepEqual(readStoredAnalyticsTimelines(storage), []);
});

test('stored local analytics history can upsert and list recent sessions', () => {
  const storage = createStorage();

  upsertStoredAnalyticsTimeline(storage, {
    session: {
      id: 'sess_local_1',
      startedAt: '2026-04-03T18:00:00.000Z',
      endedAt: '2026-04-03T18:05:00.000Z',
      sourceSurface: 'browser',
      personaId: 'researcher',
      liveModel: 'gemini-3.1-flash-live-preview',
      searchEnabled: true,
      captureMode: 'screen-share',
      createdAt: '2026-04-03T18:00:00.000Z',
    },
    events: [],
    turns: [],
    memories: [],
    summaries: [],
  });

  upsertStoredAnalyticsTimeline(storage, {
    session: {
      id: 'sess_local_2',
      startedAt: '2026-04-03T19:00:00.000Z',
      endedAt: '2026-04-03T19:05:00.000Z',
      sourceSurface: 'window',
      personaId: 'skeptic',
      liveModel: 'gemini-3.1-flash-live-preview',
      searchEnabled: false,
      captureMode: 'screen-share',
      createdAt: '2026-04-03T19:00:00.000Z',
    },
    events: [],
    turns: [],
    memories: [],
    summaries: [],
  });

  const sessions = listStoredAnalyticsSessions(storage, 10);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].session.id, 'sess_local_2');
  assert.equal(getLatestStoredAnalyticsSessionTimeline(storage)?.session.id, 'sess_local_2');
  assert.equal(getStoredAnalyticsSessionTimeline(storage, 'sess_local_1')?.session.id, 'sess_local_1');
});

test('buildLocalSessionRecapSummary produces a browser-local recap payload', () => {
  const summary = buildLocalSessionRecapSummary({
    session: {
      id: 'sess_local_recap',
      startedAt: '2026-04-03T20:00:00.000Z',
      endedAt: '2026-04-03T20:06:00.000Z',
      sourceSurface: 'screen',
      personaId: 'researcher',
      liveModel: 'gemini-3.1-flash-live-preview',
      searchEnabled: true,
      captureMode: 'screen-share',
      createdAt: '2026-04-03T20:00:00.000Z',
    },
    turns: [
      {
        id: 'turn_1',
        sessionId: 'sess_local_recap',
        role: 'user',
        startedAt: '2026-04-03T20:01:00.000Z',
        endedAt: '2026-04-03T20:01:05.000Z',
        transcript: 'Summarize what I learned.',
        promptKind: 'user-voice',
        modelName: null,
        relatedEventId: null,
      },
    ],
    memories: [
      {
        id: 'memory_1',
        sessionId: 'sess_local_recap',
        memoryType: 'helpful_info',
        title: 'Key takeaway',
        bodyMd: 'The pricing page changed from monthly to annual emphasis.',
        sourceUrl: null,
        sourceEventIds: [],
        sourceTurnIds: [],
        embeddingModel: null,
        embeddingJson: null,
        createdAt: '2026-04-03T20:05:00.000Z',
      },
    ],
    createdAt: '2026-04-03T20:06:00.000Z',
  });

  assert.equal(summary.summaryKind, 'session_recap');
  assert.equal(summary.modelName, 'browser-local');
  assert.match(summary.markdown, /Session Recap/);
  assert.equal(summary.jsonPayload.sessionId, 'sess_local_recap');
  assert.equal(summary.jsonPayload.turnCounts.user, 1);
});
