import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAppTabPath, resolveAppSurface, resolveAppTabRoute } from '../src/appSurface';

test('resolveAppSurface routes the marketing site to landing', () => {
  assert.equal(resolveAppSurface('/'), 'landing');
  assert.equal(resolveAppSurface('/features'), 'landing');
});

test('resolveAppSurface routes /app paths to the application surface', () => {
  assert.equal(resolveAppSurface('/app'), 'app');
  assert.equal(resolveAppSurface('/app/history'), 'app');
});

test('resolveAppSurface routes product tab aliases to the application surface', () => {
  assert.equal(resolveAppSurface('/product/history'), 'app');
  assert.equal(resolveAppSurface('/product/memory'), 'app');
});

test('resolveAppTabRoute maps app and product tab paths to the correct tab', () => {
  assert.equal(resolveAppTabRoute('/app'), 'transcript');
  assert.equal(resolveAppTabRoute('/app/helpful-info'), 'info');
  assert.equal(resolveAppTabRoute('/app/activity'), 'activity');
  assert.equal(resolveAppTabRoute('/product/history'), 'history');
  assert.equal(resolveAppTabRoute('/product/memory'), 'memory');
});

test('buildAppTabPath returns canonical app urls for each tab', () => {
  assert.equal(buildAppTabPath('transcript'), '/app');
  assert.equal(buildAppTabPath('info'), '/app/helpful-info');
  assert.equal(buildAppTabPath('history'), '/app/history');
  assert.equal(buildAppTabPath('memory'), '/app/memory');
});
