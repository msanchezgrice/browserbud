import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAutoSavePrompt, DEFAULT_AUTO_SAVE_INTERVAL_MS } from '../src/autoSave';

test('default auto-save interval is 30 seconds', () => {
  assert.equal(DEFAULT_AUTO_SAVE_INTERVAL_MS, 30000);
});

test('auto-save prompt requires a helpful info tool call', () => {
  const prompt = buildAutoSavePrompt();

  assert.match(prompt, /appendHelpfulInfo/i);
  assert.match(prompt, /exactly once/i);
  assert.match(prompt, /little changed/i);
});
