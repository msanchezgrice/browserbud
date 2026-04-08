const APP_ORIGINS = new Set([
  'https://browserbud.com',
  'http://localhost:3010',
  'http://127.0.0.1:3010',
]);

const MAX_TEXT_RESPONSE_CHARS = 500000;
const MAX_BINARY_RESPONSE_BYTES = 15 * 1024 * 1024;

function isHttpUrl(url) {
  return typeof url === 'string' && /^https?:\/\//.test(url);
}

function isBrowserBudUrl(url) {
  if (!isHttpUrl(url)) {
    return false;
  }

  try {
    return APP_ORIGINS.has(new URL(url).origin);
  } catch {
    return false;
  }
}

async function sendMessageToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    return null;
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function looksLikePdf(url, contentType) {
  return /application\/pdf/i.test(contentType || '') || /\.pdf(?:$|[?#])/i.test(url);
}

async function fetchPageResource(url) {
  if (!isHttpUrl(url)) {
    return {
      ok: false,
      url: typeof url === 'string' ? url : '',
      contentType: null,
      error: 'Only http and https URLs are supported.',
    };
  }

  try {
    const response = await fetch(url, {
      credentials: 'include',
    });
    const contentType = response.headers.get('content-type');
    if (!response.ok) {
      return {
        ok: false,
        url,
        contentType,
        error: `Request failed with status ${response.status}.`,
      };
    }

    if (looksLikePdf(url, contentType)) {
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > MAX_BINARY_RESPONSE_BYTES) {
        return {
          ok: false,
          url,
          contentType,
          error: `Document exceeds the ${Math.round(MAX_BINARY_RESPONSE_BYTES / (1024 * 1024))}MB fetch limit.`,
          byteLength: buffer.byteLength,
        };
      }

      return {
        ok: true,
        url,
        contentType,
        dataBase64: arrayBufferToBase64(buffer),
        byteLength: buffer.byteLength,
      };
    }

    const text = await response.text();
    return {
      ok: true,
      url,
      contentType,
      text: text.slice(0, MAX_TEXT_RESPONSE_CHARS),
      byteLength: text.length,
      truncated: text.length > MAX_TEXT_RESPONSE_CHARS,
    };
  } catch (error) {
    return {
      ok: false,
      url,
      contentType: null,
      error: error instanceof Error ? error.message : 'Unknown fetch failure.',
    };
  }
}

async function collectPageContextFromTab(tabId, navEvent) {
  const response = await sendMessageToTab(tabId, {
    type: 'BROWSERBUD_COLLECT_PAGE_CONTEXT',
    navEvent,
  });

  if (!response || response.ok !== true || !response.packet) {
    return null;
  }

  return response.packet;
}

async function broadcastPacket(packet) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs
    .filter((tab) => typeof tab.id === 'number' && isBrowserBudUrl(tab.url))
    .map((tab) => sendMessageToTab(tab.id, {
      type: 'BROWSERBUD_BRIDGE_PACKET',
      packet,
    })));
}

async function getActiveHttpTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });

  return tabs.find((tab) => typeof tab.id === 'number' && isHttpUrl(tab.url)) || null;
}

async function requestAndBroadcastActiveContext(navEvent = 'content_snapshot') {
  const activeTab = await getActiveHttpTab();
  if (!activeTab || typeof activeTab.id !== 'number') {
    return null;
  }

  const packet = await collectPageContextFromTab(activeTab.id, navEvent);
  if (!packet) {
    return null;
  }

  await broadcastPacket(packet);
  return packet;
}

function queueContextCollection(tabId, navEvent, delayMs = 150) {
  if (typeof tabId !== 'number') {
    return;
  }

  globalThis.setTimeout(async () => {
    const packet = await collectPageContextFromTab(tabId, navEvent);
    if (packet) {
      await broadcastPacket(packet);
    }
  }, delayMs);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'BROWSERBUD_REQUEST_EXTENSION_STATUS') {
    sendResponse({
      ok: true,
      version: chrome.runtime.getManifest().version,
    });
    return false;
  }

  if (message?.type === 'BROWSERBUD_REQUEST_ACTIVE_CONTEXT') {
    requestAndBroadcastActiveContext('content_snapshot').then((packet) => {
      sendResponse({
        ok: true,
        packet,
        version: chrome.runtime.getManifest().version,
      });
    });
    return true;
  }

  if (message?.type === 'BROWSERBUD_REQUEST_PAGE_RESOURCE') {
    fetchPageResource(message.url).then((response) => {
      sendResponse({
        requestId: typeof message.requestId === 'string' ? message.requestId : 'unknown',
        ...response,
      });
    });
    return true;
  }

  if (message?.type === 'BROWSERBUD_CONTEXT_FROM_TAB' && message.packet) {
    broadcastPacket(message.packet).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  return false;
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  queueContextCollection(tabId, 'activated', 80);
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) {
    queueContextCollection(details.tabId, 'committed', 80);
  }
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId === 0) {
    queueContextCollection(details.tabId, 'history_state_updated', 120);
  }
});

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId === 0) {
    queueContextCollection(details.tabId, 'completed', 220);
  }
});
