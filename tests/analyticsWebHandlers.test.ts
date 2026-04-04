import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AnalyticsStore } from '../server/analyticsStore';
import {
  handleAnalyticsSessionRecapRequest,
  handleAnalyticsSessionsRequest,
  handleLatestAnalyticsSessionTimelineRequest,
} from '../server/analyticsWebHandlers';

test('analytics web handlers support session creation, listing, latest timeline, and recap', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'browserbud-analytics-web-'));
  const dbPath = path.join(tempDir, 'analytics.sqlite');
  const store = new AnalyticsStore({ dbPath });
  store.initialize();

  try {
    const createResponse = await handleAnalyticsSessionsRequest(new Request('https://browserbud.com/api/analytics/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'sess_web',
        startedAt: '2026-04-03T18:00:00.000Z',
        captureMode: 'screen-share',
        liveModel: 'gemini-3.1-flash-live-preview',
      }),
    }), store);
    assert.equal(createResponse.status, 201);

    store.saveConversationTurn({
      id: 'turn_web',
      sessionId: 'sess_web',
      role: 'model',
      startedAt: '2026-04-03T18:00:05.000Z',
      transcript: 'Session summary is ready.',
    });

    const listResponse = await handleAnalyticsSessionsRequest(new Request('https://browserbud.com/api/analytics/sessions?limit=5'), store);
    assert.equal(listResponse.status, 200);
    const listPayload = await listResponse.json();
    assert.equal(listPayload.sessions.length, 1);

    const latestTimelineResponse = await handleLatestAnalyticsSessionTimelineRequest(new Request('https://browserbud.com/api/analytics/sessions/latest/timeline'), store);
    assert.equal(latestTimelineResponse.status, 200);
    const latestTimeline = await latestTimelineResponse.json();
    assert.equal(latestTimeline.session.id, 'sess_web');

    const recapResponse = await handleAnalyticsSessionRecapRequest(new Request('https://browserbud.com/api/analytics/sessions/sess_web/recap', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        endedAt: '2026-04-03T18:10:00.000Z',
      }),
    }), store);
    assert.equal(recapResponse.status, 200);
    const recapPayload = await recapResponse.json();
    assert.match(recapPayload.summary.markdown, /Session summary is ready/);
  } finally {
    store.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});
