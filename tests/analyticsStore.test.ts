import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AnalyticsStore } from '../server/analyticsStore';

test('AnalyticsStore persists session data and builds a session recap', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'browserbud-analytics-store-'));
  const dbPath = path.join(tempDir, 'analytics.sqlite');

  try {
    const store = new AnalyticsStore({ dbPath });
    store.initialize();

    store.createSession({
      id: 'sess_store',
      startedAt: '2026-04-03T15:00:00.000Z',
      sourceSurface: 'browser-tab',
      personaId: 'academic',
      liveModel: 'gemini-3.1-flash-live-preview',
      searchEnabled: true,
      captureMode: 'screen-share',
    });

    store.appendRawEvent({
      id: 'evt_tab',
      sessionId: 'sess_store',
      seq: 1,
      source: 'browser-extension',
      eventType: 'browser.tab_activated',
      occurredAt: '2026-04-03T15:00:10.000Z',
      url: 'https://browserbud.com/pricing',
      domain: 'browserbud.com',
      pageTitle: 'Pricing',
      payload: { windowId: 'win_1' },
    });

    store.appendRawEvent({
      id: 'evt_helpful',
      sessionId: 'sess_store',
      seq: 2,
      source: 'browserbud-ui',
      eventType: 'tool.helpful_info_saved',
      occurredAt: '2026-04-03T15:00:20.000Z',
      url: 'https://browserbud.com/pricing',
      domain: 'browserbud.com',
      pageTitle: 'Pricing',
      payload: { title: 'Pricing takeaways' },
    });

    store.saveConversationTurn({
      id: 'turn_user',
      sessionId: 'sess_store',
      role: 'user',
      startedAt: '2026-04-03T15:00:21.000Z',
      endedAt: '2026-04-03T15:00:22.000Z',
      transcript: 'Compare the monthly plan with the annual plan.',
      promptKind: 'user-voice',
    });

    store.saveConversationTurn({
      id: 'turn_model',
      sessionId: 'sess_store',
      role: 'model',
      startedAt: '2026-04-03T15:00:23.000Z',
      endedAt: '2026-04-03T15:00:25.000Z',
      transcript: 'The annual plan is cheaper if you expect to use it for more than nine months.',
      promptKind: 'live-response',
      modelName: 'gemini-3.1-flash-live-preview',
      relatedEventId: 'evt_helpful',
    });

    store.saveMemory({
      id: 'mem_note',
      sessionId: 'sess_store',
      memoryType: 'saved_note',
      title: 'Remember annual discount',
      bodyMd: 'Check the annual discount before signing up.',
      sourceUrl: 'https://browserbud.com/pricing',
      sourceEventIds: ['evt_tab', 'evt_helpful'],
      sourceTurnIds: ['turn_user', 'turn_model'],
    });

    store.completeSession('sess_store', '2026-04-03T15:10:00.000Z');

    const recap = store.generateSessionRecap('sess_store');

    assert.equal(recap.summaryKind, 'session_recap');
    assert.match(recap.markdown, /browserbud\.com/);
    assert.match(recap.markdown, /Remember annual discount/);
    assert.match(recap.markdown, /Compare the monthly plan/);
    assert.equal(recap.jsonPayload.turnCounts.user, 1);
    assert.equal(recap.jsonPayload.turnCounts.model, 1);
    assert.equal(recap.jsonPayload.memoryCounts.saved_note, 1);
    assert.ok(recap.jsonPayload.domains.some((entry) => entry.domain === 'browserbud.com'));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('AnalyticsStore lists recent sessions with their latest recap summary', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'browserbud-analytics-recent-'));
  const dbPath = path.join(tempDir, 'analytics.sqlite');

  try {
    const store = new AnalyticsStore({ dbPath });
    store.initialize();

    store.createSession({
      id: 'sess_old',
      startedAt: '2026-04-03T10:00:00.000Z',
      captureMode: 'screen-share',
    });
    store.completeSession('sess_old', '2026-04-03T10:05:00.000Z');
    store.generateSessionRecap('sess_old');

    store.createSession({
      id: 'sess_new',
      startedAt: '2026-04-03T12:00:00.000Z',
      captureMode: 'screen-share',
    });
    store.appendRawEvent({
      id: 'evt_new',
      sessionId: 'sess_new',
      seq: 1,
      source: 'browserbud-ui',
      eventType: 'tool.note_saved',
      occurredAt: '2026-04-03T12:01:00.000Z',
      domain: 'browserbud.com',
      payload: { note: 'Look at latest plan' },
    });
    store.completeSession('sess_new', '2026-04-03T12:10:00.000Z');
    store.generateSessionRecap('sess_new');

    const recentSessions = store.listRecentSessions(10);

    assert.equal(recentSessions.length, 2);
    assert.equal(recentSessions[0].session.id, 'sess_new');
    assert.equal(recentSessions[0].latestSummary?.summaryKind, 'session_recap');
    assert.equal(recentSessions[1].session.id, 'sess_old');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
