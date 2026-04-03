import assert from 'node:assert/strict';
import test from 'node:test';

import { formatLatency, mergeIncrementalTranscript, truncateSessionHandle } from '../src/liveUtils';

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
