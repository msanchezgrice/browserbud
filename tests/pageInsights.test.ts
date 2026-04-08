import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPageInsightContextPrompt,
  buildPageInsightFingerprint,
  getStoredPageInsight,
  upsertStoredPageInsight,
  type PageInsight,
} from '../src/pageInsights';
import type { CurrentPageDocument } from '../src/currentPageDocument';

function createStorage() {
  const store = new Map<string, string>();
  return {
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
  };
}

function createDocument(overrides: Partial<CurrentPageDocument> = {}): CurrentPageDocument {
  return {
    url: 'https://browserbud.com/pricing',
    contentType: 'text/html',
    source: 'fetched-html',
    text: 'BrowserBud pricing overview.\n\nStarter plan.\n\nEnterprise plan with admin controls.',
    documentTextLength: 80,
    chunkCount: 1,
    truncated: false,
    ...overrides,
  };
}

function createInsight(overrides: Partial<PageInsight> = {}): PageInsight {
  return {
    url: 'https://browserbud.com/pricing',
    title: 'Pricing - BrowserBud',
    generatedAt: '2026-04-07T22:00:00.000Z',
    documentFingerprint: 'fingerprint-1',
    documentTextLength: 80,
    contentType: 'text/html',
    source: 'fetched-html',
    pageKind: 'pricing',
    summary: 'This page explains BrowserBud pricing tiers and pushes the user toward trial or sales contact.',
    keyPoints: ['Starter includes browser memory.', 'Enterprise includes admin controls.'],
    likelyUserGoals: ['Compare plans', 'Contact sales'],
    navigationTips: ['Use the pricing table to compare tiers.', 'Look for the Contact sales form near Enterprise.'],
    ...overrides,
  };
}

test('buildPageInsightFingerprint is stable for the same document', () => {
  const document = createDocument();

  assert.equal(buildPageInsightFingerprint(document), buildPageInsightFingerprint(document));
});

test('page insights can be cached and retrieved by url and fingerprint', () => {
  const storage = createStorage();
  const first = createInsight({ documentFingerprint: 'fingerprint-1' });
  const second = createInsight({
    documentFingerprint: 'fingerprint-2',
    generatedAt: '2026-04-07T23:00:00.000Z',
    summary: 'Updated summary',
  });

  upsertStoredPageInsight(storage, first);
  upsertStoredPageInsight(storage, second);

  assert.equal(getStoredPageInsight(storage, first.url, 'fingerprint-1')?.summary, first.summary);
  assert.equal(getStoredPageInsight(storage, second.url, 'fingerprint-2')?.summary, 'Updated summary');
});

test('buildPageInsightContextPrompt turns cached analysis into a compact context update', () => {
  const prompt = buildPageInsightContextPrompt(createInsight());

  assert.match(prompt, /Background page analysis update only/i);
  assert.match(prompt, /supplemental context/i);
  assert.match(prompt, /trust the screen/i);
  assert.match(prompt, /Pricing - BrowserBud/);
  assert.match(prompt, /Compare plans/);
  assert.match(prompt, /Navigation help/i);
});
