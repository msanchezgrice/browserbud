const APP_ORIGINS = new Set([
  'https://browserbud.com',
  'http://localhost:3010',
  'http://127.0.0.1:3010',
]);

const MAX_DOCUMENT_TEXT_CHARS = 240000;

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

if (isBrowserBudPage) {
  chrome.runtime.sendMessage({ type: 'BROWSERBUD_REQUEST_EXTENSION_STATUS' }, (response) => {
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
      chrome.runtime.sendMessage({ type: 'BROWSERBUD_REQUEST_EXTENSION_STATUS' }, (response) => {
        postReady(response?.version || 'unknown');
      });
      return;
    }

    if (message.type === 'BROWSERBUD_REQUEST_ACTIVE_CONTEXT') {
      chrome.runtime.sendMessage({ type: 'BROWSERBUD_REQUEST_ACTIVE_CONTEXT' }, (response) => {
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
      chrome.runtime.sendMessage({
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

  return false;
});
