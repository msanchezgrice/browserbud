import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTranscriptFeed,
  buildRehydratedSessionState,
  buildTimedHelpfulInfoPrompt,
  formatActivityLogEntry,
  formatLatency,
  mergeIncrementalTranscript,
  parseStoredLogEntries,
  serializeLogEntries,
  shouldCommitUserTranscript,
  shouldRunTimedBackgroundSave,
  truncateSessionHandle,
} from '../src/liveUtils';

test('formatActivityLogEntry renders structured activity metadata', () => {
  const entry = formatActivityLogEntry({
    appName: 'Chrome',
    pageTitle: 'Pricing - BrowserBud',
    url: 'https://browserbud.com/pricing',
    summary: 'Comparing pricing options',
    details: 'User is reviewing monthly versus annual plans.',
  }, '2:37:10 PM');

  assert.match(entry, /### \[2:37:10 PM\] Comparing pricing options/);
  assert.match(entry, /- \*\*App:\*\* Chrome/);
  assert.match(entry, /- \*\*Page:\*\* Pricing - BrowserBud/);
  assert.match(entry, /- \*\*URL:\*\* <https:\/\/browserbud.com\/pricing>/);
  assert.match(entry, /- \*\*Details:\*\* User is reviewing monthly versus annual plans\./);
});

test('formatActivityLogEntry omits optional fields that are not provided', () => {
  const entry = formatActivityLogEntry({
    appName: 'Figma',
    summary: 'Reviewing layout spacing',
  }, '9:00:00 AM');

  assert.match(entry, /### \[9:00:00 AM\] Reviewing layout spacing/);
  assert.match(entry, /- \*\*App:\*\* Figma/);
  assert.doesNotMatch(entry, /\*\*URL:\*\*/);
  assert.doesNotMatch(entry, /\*\*Page:\*\*/);
});

test('serialize and parse persisted transcript logs preserve ordering and timestamps', () => {
  const stored = serializeLogEntries([
    {
      id: 'log_1',
      timestamp: '2026-04-03T22:00:00.000Z',
      text: 'Connected to Live Audio. You can talk now!',
      role: 'system',
    },
    {
      id: 'log_2',
      timestamp: '2026-04-03T22:00:10.000Z',
      text: 'Tell me about this page.',
      role: 'user',
    },
  ]);

  assert.deepEqual(parseStoredLogEntries(stored), [
    {
      id: 'log_1',
      timestamp: '2026-04-03T22:00:00.000Z',
      text: 'Connected to Live Audio. You can talk now!',
      role: 'system',
    },
    {
      id: 'log_2',
      timestamp: '2026-04-03T22:00:10.000Z',
      text: 'Tell me about this page.',
      role: 'user',
    },
  ]);
});

test('parseStoredLogEntries tolerates invalid persisted data', () => {
  assert.deepEqual(parseStoredLogEntries('not json'), []);
  assert.deepEqual(parseStoredLogEntries('{"oops":true}'), []);
});

test('shouldRunTimedBackgroundSave only fires when session is idle long enough', () => {
  assert.equal(shouldRunTimedBackgroundSave({
    frequencyMs: 30000,
    nowMs: 100000,
    isModelSpeaking: false,
    hasPendingTurn: false,
    hasPendingToolCall: false,
    hasReconnectTimer: false,
    lastUserActivityAtMs: 70000,
    lastPromptAtMs: 65000,
    cooldownMs: 15000,
  }), true);

  assert.equal(shouldRunTimedBackgroundSave({
    frequencyMs: 30000,
    nowMs: 100000,
    isModelSpeaking: true,
    hasPendingTurn: false,
    hasPendingToolCall: false,
    hasReconnectTimer: false,
    lastUserActivityAtMs: 70000,
    lastPromptAtMs: 65000,
    cooldownMs: 15000,
  }), false);

  assert.equal(shouldRunTimedBackgroundSave({
    frequencyMs: 30000,
    nowMs: 100000,
    isModelSpeaking: false,
    hasPendingTurn: false,
    hasPendingToolCall: false,
    hasReconnectTimer: false,
    lastUserActivityAtMs: 95000,
    lastPromptAtMs: 65000,
    cooldownMs: 15000,
  }), false);
});

test('buildTimedHelpfulInfoPrompt requests tool-only background saving', () => {
  const prompt = buildTimedHelpfulInfoPrompt();
  assert.match(prompt, /appendHelpfulInfo/);
  assert.match(prompt, /Do not speak/i);
  assert.match(prompt, /exactly once/i);
  assert.match(prompt, /little changed/i);
});

test('buildTranscriptFeed prepends a live draft transcript entry', () => {
  const feed = buildTranscriptFeed(
    [
      {
        id: 'log_1',
        timestamp: '2026-04-04T00:00:00.000Z',
        text: 'Companion reply',
        role: 'model',
      },
    ],
    {
      timestamp: '2026-04-04T00:00:05.000Z',
      text: 'I am still talking',
      role: 'user',
    },
  );

  assert.equal(feed.length, 2);
  assert.equal(feed[0].isDraft, true);
  assert.equal(feed[0].role, 'user');
  assert.equal(feed[0].text, 'I am still talking');
  assert.equal(feed[1].id, 'log_1');
});

test('buildTranscriptFeed omits empty draft transcript entries', () => {
  const feed = buildTranscriptFeed(
    [
      {
        id: 'log_1',
        timestamp: '2026-04-04T00:00:00.000Z',
        text: 'Companion reply',
        role: 'model',
      },
    ],
    {
      timestamp: '2026-04-04T00:00:05.000Z',
      text: '   ',
      role: 'user',
    },
  );

  assert.equal(feed.length, 1);
  assert.equal(feed[0].id, 'log_1');
});

test('shouldCommitUserTranscript finalizes when input transcription explicitly finishes', () => {
  assert.equal(shouldCommitUserTranscript({
    inputFinished: true,
    hasModelParts: false,
    hasToolCall: false,
    turnComplete: false,
    interrupted: false,
  }), true);
});

test('shouldCommitUserTranscript finalizes when the model starts responding', () => {
  assert.equal(shouldCommitUserTranscript({
    inputFinished: false,
    hasModelParts: true,
    hasToolCall: false,
    turnComplete: false,
    interrupted: false,
  }), true);
});

test('shouldCommitUserTranscript finalizes when a tool call arrives', () => {
  assert.equal(shouldCommitUserTranscript({
    inputFinished: false,
    hasModelParts: false,
    hasToolCall: true,
    turnComplete: false,
    interrupted: false,
  }), true);
});

test('shouldCommitUserTranscript does not finalize without an end signal', () => {
  assert.equal(shouldCommitUserTranscript({
    inputFinished: false,
    hasModelParts: false,
    hasToolCall: false,
    turnComplete: false,
    interrupted: false,
  }), false);
});

test('mergeIncrementalTranscript appends delta chunks', () => {
  let transcript = '';
  transcript = mergeIncrementalTranscript(transcript, 'The note');
  transcript = mergeIncrementalTranscript(transcript, ' "Meeting');
  transcript = mergeIncrementalTranscript(transcript, ' at 4');
  transcript = mergeIncrementalTranscript(transcript, ' PM"');
  transcript = mergeIncrementalTranscript(transcript, ' has been');
  transcript = mergeIncrementalTranscript(transcript, ' saved.');
  assert.equal(transcript, 'The note "Meeting at 4 PM" has been saved.');
});

test('mergeIncrementalTranscript keeps cumulative updates intact', () => {
  let transcript = mergeIncrementalTranscript('', 'The note');
  transcript = mergeIncrementalTranscript(transcript, 'The note has');
  transcript = mergeIncrementalTranscript(transcript, 'The note has been saved.');
  assert.equal(transcript, 'The note has been saved.');
});

test('truncateSessionHandle keeps both ends of the handle', () => {
  assert.equal(truncateSessionHandle('abcdef1234567890', 4), 'abcd...7890');
});

test('formatLatency renders waiting state and ms values', () => {
  assert.equal(formatLatency(null), 'Waiting');
  assert.equal(formatLatency(1045.4), '1045 ms');
});

test('buildRehydratedSessionState reconstructs transcript and tabs from analytics timeline', () => {
  const state = buildRehydratedSessionState({
    session: {
      id: 'sess_latest',
      startedAt: '2026-04-03T17:00:00.000Z',
      endedAt: null,
      sourceSurface: 'browser-tab',
      personaId: 'hype',
      liveModel: 'gemini-3.1-flash-live-preview',
      searchEnabled: false,
      captureMode: 'screen-share',
      createdAt: '2026-04-03T17:00:00.000Z',
    },
    events: [],
    turns: [
      {
        id: 'turn_user',
        sessionId: 'sess_latest',
        role: 'user',
        startedAt: '2026-04-03T17:00:05.000Z',
        endedAt: '2026-04-03T17:00:06.000Z',
        transcript: 'What is this plan price?',
        promptKind: 'user-voice',
        modelName: null,
        relatedEventId: null,
      },
      {
        id: 'turn_model',
        sessionId: 'sess_latest',
        role: 'model',
        startedAt: '2026-04-03T17:00:07.000Z',
        endedAt: '2026-04-03T17:00:08.000Z',
        transcript: 'The annual plan saves money.',
        promptKind: 'live-response',
        modelName: 'gemini-3.1-flash-live-preview',
        relatedEventId: null,
      },
    ],
    memories: [
      {
        id: 'mem_helpful',
        sessionId: 'sess_latest',
        memoryType: 'helpful_info',
        title: 'Pricing takeaway',
        bodyMd: 'Annual billing is cheaper over time.',
        sourceUrl: 'https://browserbud.com/pricing',
        sourceEventIds: [],
        sourceTurnIds: [],
        embeddingModel: null,
        embeddingJson: null,
        createdAt: '2026-04-03T17:00:09.000Z',
      },
      {
        id: 'mem_activity',
        sessionId: 'sess_latest',
        memoryType: 'activity_log',
        title: 'Compared pricing',
        bodyMd: '### [5:00:09 PM] Compared pricing\n\n- **App:** Chrome\n\n---\n',
        sourceUrl: 'https://browserbud.com/pricing',
        sourceEventIds: [],
        sourceTurnIds: [],
        embeddingModel: null,
        embeddingJson: null,
        createdAt: '2026-04-03T17:00:09.000Z',
      },
      {
        id: 'mem_note',
        sessionId: 'sess_latest',
        memoryType: 'saved_note',
        title: 'Remember discount',
        bodyMd: 'Remember to check the annual discount.',
        sourceUrl: 'https://browserbud.com/pricing',
        sourceEventIds: [],
        sourceTurnIds: [],
        embeddingModel: null,
        embeddingJson: null,
        createdAt: '2026-04-03T17:00:10.000Z',
      },
    ],
    summaries: [],
  });

  assert.equal(state.sessionId, 'sess_latest');
  assert.equal(state.logs[0].text, 'The annual plan saves money.');
  assert.equal(state.logs[1].text, 'What is this plan price?');
  assert.match(state.helpfulInfo, /Pricing takeaway/);
  assert.match(state.activityLog, /Compared pricing/);
  assert.match(state.savedNotes, /Remember to check the annual discount/);
});
