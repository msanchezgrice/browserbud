import test from 'node:test';
import assert from 'node:assert/strict';
import { GOOGLE_ANALYTICS_MEASUREMENT_ID, installGoogleAnalytics } from '../src/googleAnalytics';

test('BrowserBud uses the canonical GA4 stream when the public env is absent', () => {
  assert.equal(GOOGLE_ANALYTICS_MEASUREMENT_ID, 'G-ZFQ1VLWGMM');
});

test('BrowserBud GA4 loader is privacy-conscious and idempotent', () => {
  assert.match(installGoogleAnalytics.toString(), /allow_google_signals/);
  assert.match(installGoogleAnalytics.toString(), /allow_ad_personalization_signals/);
  assert.match(installGoogleAnalytics.toString(), /send_page_view/);
  assert.match(installGoogleAnalytics.toString(), /doNotTrack/);
});
