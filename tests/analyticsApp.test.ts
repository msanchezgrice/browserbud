import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createAnalyticsApp } from '../server/analyticsApp';
import { AnalyticsStore } from '../server/analyticsStore';

test('analytics API persists events and serves timeline plus recap', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'browserbud-analytics-app-'));
  const dbPath = path.join(tempDir, 'analytics.sqlite');
  const store = new AnalyticsStore({ dbPath });
  store.initialize();

  const app = createAnalyticsApp({ store });
  const server = createServer(app);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected a TCP server address.');
  }

  const baseUrl = `http://127.0.0.1:${address.port}/api/analytics`;

  try {
    const sessionResponse = await fetch(`${baseUrl}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'sess_api',
        startedAt: '2026-04-03T16:00:00.000Z',
        sourceSurface: 'browser-tab',
        personaId: 'hype',
        liveModel: 'gemini-3.1-flash-live-preview',
        searchEnabled: false,
        captureMode: 'screen-share',
      }),
    });
    assert.equal(sessionResponse.status, 201);

    const eventResponse = await fetch(`${baseUrl}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'evt_api',
        sessionId: 'sess_api',
        seq: 1,
        source: 'browserbud-ui',
        eventType: 'tool.note_saved',
        occurredAt: '2026-04-03T16:01:00.000Z',
        domain: 'docs.browserbud.com',
        url: 'https://docs.browserbud.com/setup',
        pageTitle: 'Setup',
        payload: { note: 'Remember to configure the local API.' },
      }),
    });
    assert.equal(eventResponse.status, 201);

    const turnResponse = await fetch(`${baseUrl}/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'turn_api',
        sessionId: 'sess_api',
        role: 'user',
        startedAt: '2026-04-03T16:01:05.000Z',
        endedAt: '2026-04-03T16:01:07.000Z',
        transcript: 'Summarize the setup steps for me.',
        promptKind: 'user-voice',
      }),
    });
    assert.equal(turnResponse.status, 201);

    const memoryResponse = await fetch(`${baseUrl}/memories`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'mem_api',
        sessionId: 'sess_api',
        memoryType: 'saved_note',
        title: 'Local API reminder',
        bodyMd: 'Remember to configure the local analytics API before starting a session.',
        sourceUrl: 'https://docs.browserbud.com/setup',
        sourceEventIds: ['evt_api'],
        sourceTurnIds: ['turn_api'],
      }),
    });
    assert.equal(memoryResponse.status, 201);

    const timelineResponse = await fetch(`${baseUrl}/sessions/sess_api/timeline`);
    assert.equal(timelineResponse.status, 200);
    const timeline = await timelineResponse.json();
    assert.equal(timeline.session.id, 'sess_api');
    assert.equal(timeline.events.length, 1);
    assert.equal(timeline.turns.length, 1);
    assert.equal(timeline.memories.length, 1);

    const recapResponse = await fetch(`${baseUrl}/sessions/sess_api/recap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        endedAt: '2026-04-03T16:10:00.000Z',
      }),
    });
    assert.equal(recapResponse.status, 200);
    const recap = await recapResponse.json();
    assert.match(recap.summary.markdown, /Local API reminder/);
    assert.match(recap.summary.markdown, /docs\.browserbud\.com/);

    const sessionsResponse = await fetch(`${baseUrl}/sessions?limit=5`);
    assert.equal(sessionsResponse.status, 200);
    const sessionsPayload = await sessionsResponse.json();
    assert.equal(sessionsPayload.sessions.length, 1);
    assert.equal(sessionsPayload.sessions[0].session.id, 'sess_api');
    assert.equal(sessionsPayload.sessions[0].latestSummary.summaryKind, 'session_recap');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('analytics API serves the latest session timeline for refresh rehydration', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'browserbud-analytics-latest-'));
  const dbPath = path.join(tempDir, 'analytics.sqlite');
  const store = new AnalyticsStore({ dbPath });
  store.initialize();

  store.createSession({
    id: 'sess_old',
    startedAt: '2026-04-03T16:00:00.000Z',
    captureMode: 'screen-share',
  });
  store.saveConversationTurn({
    id: 'turn_old',
    sessionId: 'sess_old',
    role: 'user',
    startedAt: '2026-04-03T16:00:05.000Z',
    transcript: 'Old session transcript',
  });

  store.createSession({
    id: 'sess_new',
    startedAt: '2026-04-03T17:00:00.000Z',
    captureMode: 'screen-share',
  });
  store.saveConversationTurn({
    id: 'turn_new',
    sessionId: 'sess_new',
    role: 'model',
    startedAt: '2026-04-03T17:00:05.000Z',
    transcript: 'Newest session transcript',
  });

  const app = createAnalyticsApp({ store });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected a TCP server address.');
  }

  const baseUrl = `http://127.0.0.1:${address.port}/api/analytics`;

  try {
    const response = await fetch(`${baseUrl}/sessions/latest/timeline`);
    assert.equal(response.status, 200);
    const timeline = await response.json();
    assert.equal(timeline.session.id, 'sess_new');
    assert.equal(timeline.turns[0].transcript, 'Newest session transcript');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await rm(tempDir, { recursive: true, force: true });
  }
});
