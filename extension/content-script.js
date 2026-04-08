const APP_ORIGINS = new Set([
  'https://browserbud.com',
  'http://localhost:3010',
  'http://127.0.0.1:3010',
]);

const MAX_DOCUMENT_TEXT_CHARS = 240000;
const OVERLAY_ELEMENT_ID = 'browserbud-live-helpful-overlay';
const HIGHLIGHT_RING_ELEMENT_ID = 'browserbud-live-highlight-ring';
const HIGHLIGHT_STYLE_ELEMENT_ID = 'browserbud-live-highlight-style';

const isBrowserBudPage = APP_ORIGINS.has(window.location.origin);

function cleanText(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function normalizeDocumentText(value) {
  return (value || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function limitText(value, maxLength) {
  const normalized = cleanText(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}...`;
}

function isVisible(element) {
  if (!(element instanceof Element)) {
    return false;
  }

  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function selectorHintsFor(element) {
  const hints = [];
  const tagName = element.tagName.toLowerCase();
  hints.push(tagName);

  if (element.id) {
    hints.push(`${tagName}#${element.id}`);
  }

  const name = element.getAttribute('name');
  if (name) {
    hints.push(`${tagName}[name="${name}"]`);
  }

  const ariaLabel = cleanText(element.getAttribute('aria-label'));
  if (ariaLabel) {
    hints.push(`${tagName}[aria-label="${ariaLabel}"]`);
  }

  const textContent = limitText(element.textContent || '', 40);
  if (textContent) {
    hints.push(`text=${textContent}`);
  }

  return [...new Set(hints)].slice(0, 4);
}

function elementRole(element) {
  return cleanText(element.getAttribute('role')) || element.tagName.toLowerCase();
}

function elementName(element) {
  if (!(element instanceof Element)) {
    return '';
  }

  return limitText(
    element.getAttribute('aria-label')
      || element.getAttribute('value')
      || element.getAttribute('placeholder')
      || element.textContent
      || '',
    120,
  );
}

function elementNearbyHeading(element) {
  return limitText(
    element.closest('section, article, main, form, nav')?.querySelector('h1, h2, h3')?.textContent || '',
    100,
  );
}

function readHeadings() {
  return [...document.querySelectorAll('h1, h2, h3')]
    .filter(isVisible)
    .map((element) => ({
      level: Number(element.tagName.slice(1)),
      text: limitText(element.textContent || '', 120),
    }))
    .filter((heading) => heading.text)
    .slice(0, 12);
}

function readLandmarks() {
  return [...document.querySelectorAll('header, main, nav, aside, footer, form, [role]')]
    .filter(isVisible)
    .map((element) => ({
      role: cleanText(element.getAttribute('role')) || element.tagName.toLowerCase(),
      label: cleanText(element.getAttribute('aria-label')) || null,
    }))
    .filter((landmark) => landmark.role)
    .slice(0, 12);
}

function readLinkSet(root) {
  if (!(root instanceof Element)) {
    return [];
  }

  return [...root.querySelectorAll('a[href]')]
    .filter(isVisible)
    .map((link) => ({
      label: limitText(link.textContent || '', 80),
      href: link.href,
    }))
    .filter((link) => link.label && link.href)
    .slice(0, 10);
}

function readBreadcrumbs() {
  const breadcrumbRoot = document.querySelector(
    'nav[aria-label*="breadcrumb" i], [data-breadcrumb], [aria-label*="breadcrumb" i]',
  );
  if (!(breadcrumbRoot instanceof Element)) {
    return [];
  }

  return [...breadcrumbRoot.querySelectorAll('a[href], span, li')]
    .map((node) => ({
      label: limitText(node.textContent || '', 80),
      href: node instanceof HTMLAnchorElement ? node.href : null,
    }))
    .filter((item) => item.label)
    .slice(0, 8);
}

function readForms() {
  return [...document.querySelectorAll('form')]
    .filter(isVisible)
    .map((form) => ({
      name: limitText(
        form.getAttribute('aria-label')
          || form.getAttribute('name')
          || form.querySelector('legend, h1, h2, h3')?.textContent
          || 'Form',
        100,
      ),
      fields: [...form.querySelectorAll('input, textarea, select')]
        .map((field) => cleanText(field.getAttribute('name')) || cleanText(field.getAttribute('aria-label')) || cleanText(field.getAttribute('placeholder')))
        .filter(Boolean)
        .slice(0, 8),
      submitLabels: [...form.querySelectorAll('button, input[type="submit"]')]
        .map((button) => limitText(button.textContent || button.getAttribute('value') || '', 60))
        .filter(Boolean)
        .slice(0, 4),
    }))
    .slice(0, 5);
}

function inferActiveSection() {
  const headings = [...document.querySelectorAll('h1, h2, h3, h4')]
    .filter(isVisible)
    .map((element) => ({
      text: limitText(element.textContent || '', 120),
      top: element.getBoundingClientRect().top,
    }))
    .filter((heading) => heading.text);

  if (headings.length === 0) {
    return null;
  }

  const sorted = headings
    .filter((heading) => heading.top <= Math.max(window.innerHeight * 0.35, 240))
    .sort((left, right) => Math.abs(left.top) - Math.abs(right.top));

  return sorted[0]?.text || headings[0].text;
}

function readMainTextExcerpt() {
  const root = document.querySelector('main, article, [role="main"]') || document.body;
  return limitText(root?.textContent || '', 280);
}

function readMetaDescription() {
  const description = document.querySelector('meta[name="description"]')?.getAttribute('content')
    || document.querySelector('meta[property="og:description"]')?.getAttribute('content')
    || '';
  return limitText(description, 220) || null;
}

function readDocumentText() {
  const root = document.querySelector('main, article, [role="main"]') || document.body;
  const fullText = normalizeDocumentText(root?.innerText || root?.textContent || '');
  if (!fullText) {
    return {
      text: '',
      textLength: 0,
      truncated: false,
    };
  }

  return {
    text: fullText.slice(0, MAX_DOCUMENT_TEXT_CHARS),
    textLength: fullText.length,
    truncated: fullText.length > MAX_DOCUMENT_TEXT_CHARS,
  };
}

function readAnchors() {
  return [...document.querySelectorAll('a[href], button, [role="button"], input[type="submit"], input[type="button"]')]
    .filter(isVisible)
    .map((element, index) => {
      const label = limitText(
        element.textContent
          || element.getAttribute('aria-label')
          || element.getAttribute('value')
          || '',
        100,
      );
      const nearbyHeading = element.closest('section, article, main')?.querySelector('h1, h2, h3')?.textContent || '';

      return {
        anchorId: element.id || `${element.tagName.toLowerCase()}-${index}`,
        role: cleanText(element.getAttribute('role')) || element.tagName.toLowerCase(),
        name: label || 'Unnamed action',
        selectorHints: selectorHintsFor(element),
        visible: true,
        interactable: !element.hasAttribute('disabled'),
        nearbyHeading: limitText(nearbyHeading, 80) || null,
      };
    })
    .slice(0, 25);
}

function collectPageContext(navEvent) {
  const primaryNavRoot = document.querySelector('header nav, nav[aria-label*="primary" i], nav[aria-label*="main" i]');
  const localNavRoot = document.querySelector('aside nav, nav[aria-label*="section" i], nav[aria-label*="local" i]');
  const documentText = readDocumentText();

  return {
    packetVersion: 1,
    tabId: -1,
    windowId: -1,
    documentId: cleanText(document.documentElement.getAttribute('data-document-id')) || null,
    url: window.location.href,
    domain: window.location.hostname,
    title: document.title || window.location.hostname,
    navEvent,
    capturedAt: new Date().toISOString(),
    page: {
      canonicalUrl: document.querySelector('link[rel="canonical"]')?.href || null,
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
      pageTypeHint: cleanText(document.body?.getAttribute('data-page-type')) || null,
      metaDescription: readMetaDescription(),
      mainTextExcerpt: readMainTextExcerpt(),
      documentText: documentText.text || null,
      documentTextLength: documentText.textLength,
      documentTextTruncated: documentText.truncated,
    },
    location: {
      activeSection: inferActiveSection(),
      breadcrumbLabels: readBreadcrumbs().map((item) => item.label),
      scrollY: Math.round(window.scrollY),
      viewportHeight: window.innerHeight,
    },
    contentMap: {
      headings: readHeadings(),
      landmarks: readLandmarks(),
      forms: readForms(),
    },
    navMap: {
      primaryLinks: readLinkSet(primaryNavRoot),
      localLinks: readLinkSet(localNavRoot),
      breadcrumbs: readBreadcrumbs(),
    },
    anchors: readAnchors(),
  };
}

function postToBrowserBudPage(message) {
  if (!isBrowserBudPage) {
    return;
  }

  window.postMessage(message, window.location.origin);
}

function postReady(version) {
  postToBrowserBudPage({
    source: 'browserbud-extension',
    type: 'BROWSERBUD_EXTENSION_READY',
    payload: {
      version,
    },
  });
}

function postInvalidated(reason) {
  postToBrowserBudPage({
    source: 'browserbud-extension',
    type: 'BROWSERBUD_EXTENSION_INVALIDATED',
    payload: {
      reason: reason || 'Extension context invalidated. Reload BrowserBud and the browsing tab.',
    },
  });
}

function safeRuntimeSendMessage(message, callback) {
  try {
    if (!chrome?.runtime?.id) {
      postInvalidated('Extension context invalidated. Reload BrowserBud and the browsing tab.');
      if (typeof callback === 'function') {
        callback(null);
      }
      return;
    }

    chrome.runtime.sendMessage(message, (response) => {
      const lastError = chrome.runtime?.lastError;
      if (lastError) {
        if (/context invalidated|Receiving end does not exist|message port closed/i.test(lastError.message || '')) {
          postInvalidated(lastError.message || 'Extension context invalidated. Reload BrowserBud and the browsing tab.');
        }
        if (typeof callback === 'function') {
          callback(null);
        }
        return;
      }

      if (typeof callback === 'function') {
        callback(response);
      }
    });
  } catch (error) {
    postInvalidated(error instanceof Error ? error.message : 'Extension context invalidated. Reload BrowserBud and the browsing tab.');
    if (typeof callback === 'function') {
      callback(null);
    }
  }
}

function removeHelpfulOverlay() {
  document.getElementById(OVERLAY_ELEMENT_ID)?.remove();
}

function ensureHighlightStyles() {
  if (document.getElementById(HIGHLIGHT_STYLE_ELEMENT_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = HIGHLIGHT_STYLE_ELEMENT_ID;
  style.textContent = `
    @keyframes browserbud-highlight-pulse {
      0% { transform: scale(0.98); opacity: 0.72; }
      50% { transform: scale(1.01); opacity: 1; }
      100% { transform: scale(0.99); opacity: 0.8; }
    }
  `;
  document.documentElement.appendChild(style);
}

function removeHighlightRing() {
  document.getElementById(HIGHLIGHT_RING_ELEMENT_ID)?.remove();
}

function renderHighlightRing(element) {
  if (!(element instanceof Element)) {
    return;
  }

  ensureHighlightStyles();
  removeHighlightRing();

  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return;
  }

  const ring = document.createElement('div');
  ring.id = HIGHLIGHT_RING_ELEMENT_ID;
  Object.assign(ring.style, {
    position: 'fixed',
    left: `${Math.max(rect.left - 8, 0)}px`,
    top: `${Math.max(rect.top - 8, 0)}px`,
    width: `${Math.min(rect.width + 16, window.innerWidth)}px`,
    height: `${Math.min(rect.height + 16, window.innerHeight)}px`,
    zIndex: '2147483647',
    pointerEvents: 'none',
    borderRadius: '18px',
    border: '3px solid rgba(20, 184, 166, 0.95)',
    boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.18), 0 0 0 8px rgba(20, 184, 166, 0.18)',
    background: 'rgba(45, 212, 191, 0.08)',
    animation: 'browserbud-highlight-pulse 1s ease-in-out infinite',
  });

  document.documentElement.appendChild(ring);
  window.setTimeout(() => {
    if (ring.parentNode) {
      ring.remove();
    }
  }, 4200);
}

function resolveSelectorHint(hint) {
  if (!hint || hint.startsWith('text=')) {
    return null;
  }

  try {
    const candidate = document.querySelector(hint);
    return candidate instanceof Element ? candidate : null;
  } catch {
    return null;
  }
}

function scoreHighlightCandidate(element, request) {
  const role = elementRole(element).toLowerCase();
  const name = elementName(element).toLowerCase();
  const nearbyHeading = elementNearbyHeading(element).toLowerCase();

  let score = 0;
  if (request.anchorId && element.id && element.id === request.anchorId) {
    score += 80;
  }

  if (request.role && role === cleanText(request.role).toLowerCase()) {
    score += 18;
  }

  if (request.name) {
    const normalizedName = cleanText(request.name).toLowerCase();
    if (name === normalizedName) {
      score += 40;
    } else if (name.includes(normalizedName) || normalizedName.includes(name)) {
      score += 18;
    }
  }

  if (request.nearbyHeading) {
    const normalizedHeading = cleanText(request.nearbyHeading).toLowerCase();
    if (nearbyHeading === normalizedHeading) {
      score += 16;
    } else if (nearbyHeading.includes(normalizedHeading) || normalizedHeading.includes(nearbyHeading)) {
      score += 8;
    }
  }

  if (isVisible(element)) {
    score += 6;
  }

  if (!(element instanceof HTMLButtonElement) || !element.disabled) {
    score += 2;
  }

  return score;
}

function findHighlightTarget(request) {
  const selectorCandidates = (Array.isArray(request.selectorHints) ? request.selectorHints : [])
    .map(resolveSelectorHint)
    .filter(Boolean);

  if (selectorCandidates.length > 0) {
    return selectorCandidates[0];
  }

  const candidates = [...document.querySelectorAll('a[href], button, [role="button"], input, textarea, select, [tabindex]')]
    .filter((element) => element instanceof Element)
    .filter(isVisible);

  const ranked = candidates
    .map((element) => ({
      element,
      score: scoreHighlightCandidate(element, request),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);

  return ranked[0]?.element || null;
}

function handleHighlightRequest(message) {
  const target = findHighlightTarget(message);
  if (!target) {
    return {
      requestId: typeof message.requestId === 'string' ? message.requestId : 'unknown',
      ok: false,
      url: window.location.href,
      error: 'No matching visible element was found on this page.',
    };
  }

  if (message.scrollIntoView !== false) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }

  window.setTimeout(() => {
    renderHighlightRing(target);
  }, message.scrollIntoView === false ? 20 : 260);

  return {
    requestId: typeof message.requestId === 'string' ? message.requestId : 'unknown',
    ok: true,
    url: window.location.href,
    anchorId: target.id || null,
    matchedName: elementName(target) || null,
    matchedRole: elementRole(target) || null,
  };
}

function ensureHelpfulOverlay() {
  let element = document.getElementById(OVERLAY_ELEMENT_ID);
  if (element) {
    return element;
  }

  element = document.createElement('div');
  element.id = OVERLAY_ELEMENT_ID;
  Object.assign(element.style, {
    position: 'fixed',
    right: '20px',
    bottom: '20px',
    zIndex: '2147483646',
    maxWidth: '360px',
    minWidth: '220px',
    padding: '14px 16px',
    borderRadius: '18px',
    background: 'rgba(15, 23, 42, 0.92)',
    color: '#f8fafc',
    boxShadow: '0 18px 40px rgba(15, 23, 42, 0.32)',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    fontSize: '14px',
    lineHeight: '1.5',
    letterSpacing: '0.01em',
    whiteSpace: 'pre-wrap',
    backdropFilter: 'blur(14px)',
    border: '1px solid rgba(148, 163, 184, 0.22)',
    pointerEvents: 'none',
  });
  document.documentElement.appendChild(element);
  return element;
}

function renderHelpfulOverlay(text) {
  const normalized = cleanText(text);
  if (!normalized || isBrowserBudPage) {
    removeHelpfulOverlay();
    return;
  }

  const element = ensureHelpfulOverlay();
  element.textContent = normalized;
}

if (isBrowserBudPage) {
  safeRuntimeSendMessage({ type: 'BROWSERBUD_REQUEST_EXTENSION_STATUS' }, (response) => {
    postReady(response?.version || 'unknown');
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) {
      return;
    }

    const message = event.data;
    if (!message || message.source !== 'browserbud-app') {
      return;
    }

    if (message.type === 'BROWSERBUD_REQUEST_EXTENSION_STATUS') {
      safeRuntimeSendMessage({ type: 'BROWSERBUD_REQUEST_EXTENSION_STATUS' }, (response) => {
        postReady(response?.version || 'unknown');
      });
      return;
    }

    if (message.type === 'BROWSERBUD_REQUEST_ACTIVE_CONTEXT') {
      safeRuntimeSendMessage({ type: 'BROWSERBUD_REQUEST_ACTIVE_CONTEXT' }, (response) => {
        if (response?.packet) {
          postToBrowserBudPage({
            source: 'browserbud-extension',
            type: 'BROWSERBUD_CONTEXT_PACKET',
            payload: response.packet,
          });
        }
      });
      return;
    }

    if (message.type === 'BROWSERBUD_REQUEST_PAGE_RESOURCE') {
      safeRuntimeSendMessage({
        type: 'BROWSERBUD_REQUEST_PAGE_RESOURCE',
        requestId: message.payload?.requestId,
        url: message.payload?.url,
      }, (response) => {
        postToBrowserBudPage({
          source: 'browserbud-extension',
          type: 'BROWSERBUD_PAGE_RESOURCE_RESPONSE',
          payload: response || {
            requestId: message.payload?.requestId || 'unknown',
            ok: false,
            url: typeof message.payload?.url === 'string' ? message.payload.url : '',
            contentType: null,
            error: 'Extension fetch failed.',
          },
        });
      });
      return;
    }

    if (message.type === 'BROWSERBUD_SET_HELPFUL_OVERLAY') {
      safeRuntimeSendMessage({
        type: 'BROWSERBUD_SET_HELPFUL_OVERLAY',
        text: typeof message.payload?.text === 'string' ? message.payload.text : '',
        title: typeof message.payload?.title === 'string' ? message.payload.title : '',
        url: typeof message.payload?.url === 'string' ? message.payload.url : '',
        visible: message.payload?.visible !== false,
      }, () => {});
      return;
    }

    if (message.type === 'BROWSERBUD_HIGHLIGHT_PAGE_ELEMENT') {
      safeRuntimeSendMessage({
        type: 'BROWSERBUD_HIGHLIGHT_TARGET',
        requestId: message.payload?.requestId,
        anchorId: typeof message.payload?.anchorId === 'string' ? message.payload.anchorId : '',
        name: typeof message.payload?.name === 'string' ? message.payload.name : '',
        role: typeof message.payload?.role === 'string' ? message.payload.role : '',
        nearbyHeading: typeof message.payload?.nearbyHeading === 'string' ? message.payload.nearbyHeading : '',
        selectorHints: Array.isArray(message.payload?.selectorHints) ? message.payload.selectorHints : [],
        scrollIntoView: message.payload?.scrollIntoView !== false,
      }, (response) => {
        postToBrowserBudPage({
          source: 'browserbud-extension',
          type: 'BROWSERBUD_HIGHLIGHT_RESPONSE',
          payload: response || {
            requestId: typeof message.payload?.requestId === 'string' ? message.payload.requestId : 'unknown',
            ok: false,
            url: window.location.href,
            error: 'Extension highlight failed.',
          },
        });
      });
    }
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'BROWSERBUD_COLLECT_PAGE_CONTEXT') {
    const packet = collectPageContext(message.navEvent || 'content_snapshot');
    if (sender?.tab?.id) {
      packet.tabId = sender.tab.id;
    }
    if (sender?.tab?.windowId) {
      packet.windowId = sender.tab.windowId;
    }
    sendResponse({ ok: true, packet });
    return false;
  }

  if (message?.type === 'BROWSERBUD_BRIDGE_PACKET' && isBrowserBudPage) {
    postToBrowserBudPage({
      source: 'browserbud-extension',
      type: 'BROWSERBUD_CONTEXT_PACKET',
      payload: message.packet,
    });
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'BROWSERBUD_OVERLAY_UPDATE') {
    renderHelpfulOverlay(typeof message.text === 'string' ? message.text : '');
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'BROWSERBUD_OVERLAY_CLEAR') {
    removeHelpfulOverlay();
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'BROWSERBUD_HIGHLIGHT_TARGET') {
    sendResponse(handleHighlightRequest(message));
    return false;
  }

  return false;
});
