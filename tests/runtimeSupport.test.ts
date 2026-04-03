import assert from 'node:assert/strict';
import test from 'node:test';

import { assessRuntimeSupport } from '../src/runtimeSupport';

test('allows desktop browsers with the required media APIs', () => {
  const result = assessRuntimeSupport({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    viewportWidth: 1440,
    hasDisplayMedia: true,
    hasUserMedia: true,
    hasAudioContext: true,
    hasAudioWorklet: true,
  });

  assert.equal(result.supported, true);
  assert.equal(result.desktopOnly, false);
  assert.deepEqual(result.reasons, []);
});

test('blocks mobile-os phone layouts with a desktop-only message', () => {
  const result = assessRuntimeSupport({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    viewportWidth: 390,
    hasDisplayMedia: false,
    hasUserMedia: true,
    hasAudioContext: true,
    hasAudioWorklet: true,
  });

  assert.equal(result.supported, false);
  assert.equal(result.desktopOnly, true);
  assert.equal(result.mobileOs, true);
  assert.match(result.reasons.join(' '), /mobile/i);
});

test('blocks desktop browsers when screen capture is unavailable', () => {
  const result = assessRuntimeSupport({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    viewportWidth: 1280,
    hasDisplayMedia: false,
    hasUserMedia: true,
    hasAudioContext: true,
    hasAudioWorklet: true,
  });

  assert.equal(result.supported, false);
  assert.equal(result.desktopOnly, false);
  assert.match(result.reasons.join(' '), /screen/i);
});
