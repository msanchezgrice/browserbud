import assert from 'node:assert/strict';
import test from 'node:test';

import { formatActivityLogEntry, formatLatency, mergeIncrementalTranscript, truncateSessionHandle } from '../src/liveUtils';

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
