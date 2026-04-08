import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createBrowserBudBridgeRequest,
  parseBrowserBudBridgeMessage,
} from '../src/browserContextBridge';
import type { BrowserContextPacket } from '../src/browserContext';

const packet: BrowserContextPacket = {
  packetVersion: 1,
  tabId: 11,
  windowId: 9,
  documentId: 'doc-bridge',
  url: 'https://browserbud.com/pricing',
  domain: 'browserbud.com',
  title: 'Pricing - BrowserBud',
  navEvent: 'completed',
  capturedAt: '2026-04-07T22:00:00.000Z',
  page: {
    canonicalUrl: 'https://browserbud.com/pricing',
    pathname: '/pricing',
    search: '',
    hash: '',
    pageTypeHint: 'pricing',
    mainTextExcerpt: 'Pricing page',
  },
  location: {
    activeSection: 'Pricing',
    breadcrumbLabels: ['Home', 'Pricing'],
    scrollY: 0,
    viewportHeight: 900,
  },
  contentMap: {
    headings: [{ level: 1, text: 'Pricing' }],
    landmarks: [{ role: 'main', label: 'Pricing content' }],
    forms: [],
  },
  navMap: {
    primaryLinks: [{ label: 'Pricing', href: 'https://browserbud.com/pricing' }],
    localLinks: [],
    breadcrumbs: [{ label: 'Pricing', href: 'https://browserbud.com/pricing' }],
  },
  anchors: [],
};

test('createBrowserBudBridgeRequest builds an app-to-extension request envelope', () => {
  assert.deepEqual(createBrowserBudBridgeRequest('REQUEST_ACTIVE_CONTEXT'), {
    source: 'browserbud-app',
    type: 'BROWSERBUD_REQUEST_ACTIVE_CONTEXT',
  });
});

test('parseBrowserBudBridgeMessage recognizes extension ready and context packets', () => {
  assert.deepEqual(parseBrowserBudBridgeMessage({
    source: 'browserbud-extension',
    type: 'BROWSERBUD_EXTENSION_READY',
    payload: { version: '0.1.0' },
  }), {
    kind: 'ready',
    version: '0.1.0',
  });

  assert.deepEqual(parseBrowserBudBridgeMessage({
    source: 'browserbud-extension',
    type: 'BROWSERBUD_CONTEXT_PACKET',
    payload: packet,
  }), {
    kind: 'packet',
    packet,
  });
});

test('parseBrowserBudBridgeMessage ignores malformed events', () => {
  assert.equal(parseBrowserBudBridgeMessage(null), null);
  assert.equal(parseBrowserBudBridgeMessage({ source: 'other-app' }), null);
  assert.equal(parseBrowserBudBridgeMessage({
    source: 'browserbud-extension',
    type: 'BROWSERBUD_CONTEXT_PACKET',
    payload: { nope: true },
  }), null);
});
