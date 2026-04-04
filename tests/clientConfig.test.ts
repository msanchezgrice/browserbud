import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BROWSERBUD_API_KEY_STORAGE_KEY,
  createStoredApiKeyController,
  resolveAnalyticsApiUrl,
} from '../src/clientConfig';

test('resolveAnalyticsApiUrl prefers an explicit configured URL', () => {
  assert.equal(
    resolveAnalyticsApiUrl({
      configuredUrl: 'https://api.browserbud.com/analytics/',
      windowOrigin: 'https://browserbud.com',
      windowHostname: 'browserbud.com',
    }),
    'https://api.browserbud.com/analytics',
  );
});

test('resolveAnalyticsApiUrl disables shared analytics routes in production by default', () => {
  assert.equal(
    resolveAnalyticsApiUrl({
      configuredUrl: '',
      windowOrigin: 'https://browserbud.com',
      windowHostname: 'browserbud.com',
    }),
    null,
  );
});

test('resolveAnalyticsApiUrl falls back to localhost during local development', () => {
  assert.equal(
    resolveAnalyticsApiUrl({
      configuredUrl: '',
      windowOrigin: 'http://localhost:3010',
      windowHostname: 'localhost',
    }),
    'http://127.0.0.1:3011/api/analytics',
  );
});

test('stored api key controller trims persisted values and removes blanks', () => {
  const storage = new Map<string, string>();
  const controller = createStoredApiKeyController({
    getItem(key) {
      return storage.has(key) ? storage.get(key)! : null;
    },
    setItem(key, value) {
      storage.set(key, value);
    },
    removeItem(key) {
      storage.delete(key);
    },
  });

  controller.set('  test-key-123  ');
  assert.equal(storage.get(BROWSERBUD_API_KEY_STORAGE_KEY), 'test-key-123');
  assert.equal(controller.get(), 'test-key-123');

  controller.set('   ');
  assert.equal(storage.has(BROWSERBUD_API_KEY_STORAGE_KEY), false);
  assert.equal(controller.get(), '');
});
