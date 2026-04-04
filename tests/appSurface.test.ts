import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveAppSurface } from '../src/appSurface';

test('resolveAppSurface routes the marketing site to landing', () => {
  assert.equal(resolveAppSurface('/'), 'landing');
  assert.equal(resolveAppSurface('/features'), 'landing');
});

test('resolveAppSurface routes /app paths to the application surface', () => {
  assert.equal(resolveAppSurface('/app'), 'app');
  assert.equal(resolveAppSurface('/app/history'), 'app');
});
