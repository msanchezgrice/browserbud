import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBrowserContextPrompt,
  buildCurrentPageToolSnapshot,
  getCaptureModeRequirements,
  isSignificantBrowserContextUpdate,
  searchBrowserContextDocument,
  type BrowserContextPacket,
} from '../src/browserContext';

function createPacket(overrides: Partial<BrowserContextPacket> = {}): BrowserContextPacket {
  return {
    packetVersion: 1,
    tabId: 11,
    windowId: 3,
    documentId: 'doc-1',
    url: 'https://browserbud.com/pricing',
    domain: 'browserbud.com',
    title: 'Pricing - BrowserBud',
    navEvent: 'completed',
    capturedAt: '2026-04-07T21:00:00.000Z',
    page: {
      canonicalUrl: 'https://browserbud.com/pricing',
      pathname: '/pricing',
      search: '',
      hash: '',
      pageTypeHint: 'pricing',
      metaDescription: 'Compare BrowserBud plans, memory features, and enterprise options.',
      mainTextExcerpt: 'Compare plans and find the right BrowserBud tier.',
      documentText: [
        'BrowserBud pricing overview.',
        'Starter plan includes browser memory.',
        'Enterprise plan includes admin controls and support.',
        'Contact sales for custom contracts.',
      ].join('\n\n'),
      documentTextLength: 146,
    },
    location: {
      activeSection: 'Pricing table',
      breadcrumbLabels: ['Home', 'Pricing'],
      scrollY: 240,
      viewportHeight: 900,
    },
    contentMap: {
      headings: [
        { level: 1, text: 'Pricing' },
        { level: 2, text: 'Enterprise' },
      ],
      landmarks: [
        { role: 'banner', label: 'Top navigation' },
        { role: 'main', label: 'Pricing content' },
      ],
      forms: [
        {
          name: 'Contact sales',
          fields: ['email', 'company'],
          submitLabels: ['Contact sales'],
        },
      ],
    },
    navMap: {
      primaryLinks: [
        { label: 'Product', href: 'https://browserbud.com/product' },
        { label: 'Pricing', href: 'https://browserbud.com/pricing' },
      ],
      localLinks: [
        { label: 'Enterprise', href: 'https://browserbud.com/pricing#enterprise' },
      ],
      breadcrumbs: [
        { label: 'Home', href: 'https://browserbud.com/' },
        { label: 'Pricing', href: 'https://browserbud.com/pricing' },
      ],
    },
    anchors: [
      {
        anchorId: 'button:start-free-trial',
        role: 'button',
        name: 'Start free trial',
        selectorHints: ['button[data-cta="trial"]', 'text=Start free trial'],
        visible: true,
        interactable: true,
        nearbyHeading: 'Pricing',
      },
    ],
    ...overrides,
  };
}

test('getCaptureModeRequirements treats multimodal as screen plus extension', () => {
  assert.deepEqual(getCaptureModeRequirements('screen-share'), {
    requiresScreenShare: true,
    requiresExtension: false,
  });

  assert.deepEqual(getCaptureModeRequirements('multimodal'), {
    requiresScreenShare: true,
    requiresExtension: true,
  });

  assert.deepEqual(getCaptureModeRequirements('browser-extension'), {
    requiresScreenShare: false,
    requiresExtension: true,
  });
});

test('buildBrowserContextPrompt compresses useful site context for live enrichment', () => {
  const prompt = buildBrowserContextPrompt(createPacket());

  assert.match(prompt, /Supplemental browser context update only/i);
  assert.match(prompt, /source of truth for what is visibly on screen right now/i);
  assert.match(prompt, /browserbud\.com/i);
  assert.match(prompt, /\/pricing/);
  assert.match(prompt, /Pricing table/);
  assert.match(prompt, /Product, Pricing/);
  assert.match(prompt, /Start free trial/);
  assert.match(prompt, /Page description: Compare BrowserBud plans/i);
  assert.match(prompt, /Do not respond aloud/i);
});

test('isSignificantBrowserContextUpdate ignores duplicate snapshots and catches route changes', () => {
  const first = createPacket();
  const duplicate = createPacket({
    capturedAt: '2026-04-07T21:00:02.000Z',
    navEvent: 'content_snapshot',
  });
  const changed = createPacket({
    url: 'https://browserbud.com/pricing#enterprise',
    navEvent: 'history_state_updated',
    page: {
      canonicalUrl: 'https://browserbud.com/pricing',
      pathname: '/pricing',
      search: '',
      hash: '#enterprise',
      pageTypeHint: 'pricing',
      mainTextExcerpt: 'Enterprise plan details.',
    },
    location: {
      activeSection: 'Enterprise',
      breadcrumbLabels: ['Home', 'Pricing'],
      scrollY: 860,
      viewportHeight: 900,
    },
  });

  assert.equal(isSignificantBrowserContextUpdate(first, duplicate), false);
  assert.equal(isSignificantBrowserContextUpdate(first, changed), true);
});

test('searchBrowserContextDocument returns relevant document chunks from off-screen page text', () => {
  const results = searchBrowserContextDocument(createPacket(), 'enterprise support');

  assert.equal(results.length > 0, true);
  assert.match(results[0], /Enterprise plan includes admin controls and support/);
});

test('buildCurrentPageToolSnapshot returns a compact tool payload for current-page inspection', () => {
  const snapshot = buildCurrentPageToolSnapshot(createPacket());

  assert.equal(snapshot.url, 'https://browserbud.com/pricing');
  assert.equal(snapshot.title, 'Pricing - BrowserBud');
  assert.equal(snapshot.metaDescription, 'Compare BrowserBud plans, memory features, and enterprise options.');
  assert.equal(snapshot.documentTextLength, 146);
  assert.equal(snapshot.topHeadings[0], 'Pricing');
  assert.equal(snapshot.anchorNames[0], 'Start free trial');
  assert.match(snapshot.documentExcerpt, /BrowserBud pricing overview/);
});
