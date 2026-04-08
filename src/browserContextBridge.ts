import { isBrowserContextPacket, type BrowserContextPacket } from './browserContext';

export type BrowserBudBridgeRequestType =
  | 'REQUEST_ACTIVE_CONTEXT'
  | 'REQUEST_EXTENSION_STATUS'
  | 'REQUEST_PAGE_RESOURCE'
  | 'SET_HELPFUL_OVERLAY'
  | 'HIGHLIGHT_PAGE_ELEMENT';

type BrowserBudBridgeRequest = {
  source: 'browserbud-app';
  type: `BROWSERBUD_${BrowserBudBridgeRequestType}`;
  payload?: {
    requestId?: string;
    url?: string;
    text?: string;
    title?: string;
    visible?: boolean;
    anchorId?: string;
    name?: string;
    role?: string;
    nearbyHeading?: string;
    selectorHints?: string[];
    scrollIntoView?: boolean;
  };
};

type BrowserBudBridgeReadyMessage = {
  source: 'browserbud-extension';
  type: 'BROWSERBUD_EXTENSION_READY';
  payload?: {
    version?: string;
  };
};

type BrowserBudBridgeInvalidatedMessage = {
  source: 'browserbud-extension';
  type: 'BROWSERBUD_EXTENSION_INVALIDATED';
  payload?: {
    reason?: string;
  };
};

type BrowserBudBridgePacketMessage = {
  source: 'browserbud-extension';
  type: 'BROWSERBUD_CONTEXT_PACKET';
  payload: BrowserContextPacket;
};

export type BrowserBudPageResourceResponse = {
  requestId: string;
  ok: boolean;
  url: string;
  contentType: string | null;
  text?: string | null;
  dataBase64?: string | null;
  byteLength?: number | null;
  truncated?: boolean;
  error?: string | null;
};

type BrowserBudBridgeResourceMessage = {
  source: 'browserbud-extension';
  type: 'BROWSERBUD_PAGE_RESOURCE_RESPONSE';
  payload: BrowserBudPageResourceResponse;
};

export type BrowserBudHighlightResponse = {
  requestId: string;
  ok: boolean;
  url: string;
  anchorId?: string | null;
  matchedName?: string | null;
  matchedRole?: string | null;
  error?: string | null;
};

type BrowserBudBridgeHighlightMessage = {
  source: 'browserbud-extension';
  type: 'BROWSERBUD_HIGHLIGHT_RESPONSE';
  payload: BrowserBudHighlightResponse;
};

export type BrowserBudBridgeEvent =
  | { kind: 'ready'; version: string }
  | { kind: 'invalidated'; reason: string }
  | { kind: 'packet'; packet: BrowserContextPacket }
  | { kind: 'resource'; response: BrowserBudPageResourceResponse }
  | { kind: 'highlight'; response: BrowserBudHighlightResponse };

export function createBrowserBudBridgeRequest(
  type: BrowserBudBridgeRequestType,
  payload?: BrowserBudBridgeRequest['payload'],
): BrowserBudBridgeRequest {
  return {
    source: 'browserbud-app',
    type: `BROWSERBUD_${type}`,
    ...(payload ? { payload } : {}),
  };
}

export function parseBrowserBudBridgeMessage(value: unknown): BrowserBudBridgeEvent | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const message = value as {
    source?: unknown;
    type?: unknown;
    payload?: unknown;
  };
  if (message.source !== 'browserbud-extension') {
    return null;
  }

  if (message.type === 'BROWSERBUD_EXTENSION_READY') {
    const payload = message.payload && typeof message.payload === 'object'
      ? message.payload as { version?: unknown }
      : null;
    return {
      kind: 'ready',
      version: typeof payload?.version === 'string' ? payload.version : 'unknown',
    };
  }

  if (message.type === 'BROWSERBUD_EXTENSION_INVALIDATED') {
    const payload = message.payload && typeof message.payload === 'object'
      ? message.payload as BrowserBudBridgeInvalidatedMessage['payload']
      : null;
    return {
      kind: 'invalidated',
      reason: typeof payload?.reason === 'string'
        ? payload.reason
        : 'Extension context invalidated. Reload BrowserBud and the browsing tab.',
    };
  }

  if (message.type === 'BROWSERBUD_CONTEXT_PACKET' && isBrowserContextPacket(message.payload)) {
    return {
      kind: 'packet',
      packet: message.payload,
    };
  }

  if (message.type === 'BROWSERBUD_PAGE_RESOURCE_RESPONSE') {
    const payload = message.payload as BrowserBudBridgeResourceMessage['payload'];
    if (
      payload
      && typeof payload.requestId === 'string'
      && typeof payload.ok === 'boolean'
      && typeof payload.url === 'string'
    ) {
      return {
        kind: 'resource',
        response: {
          requestId: payload.requestId,
          ok: payload.ok,
          url: payload.url,
          contentType: typeof payload.contentType === 'string' ? payload.contentType : null,
          text: typeof payload.text === 'string' ? payload.text : null,
          dataBase64: typeof payload.dataBase64 === 'string' ? payload.dataBase64 : null,
          byteLength: typeof payload.byteLength === 'number' ? payload.byteLength : null,
          truncated: Boolean(payload.truncated),
          error: typeof payload.error === 'string' ? payload.error : null,
        },
      };
    }
  }

  if (message.type === 'BROWSERBUD_HIGHLIGHT_RESPONSE') {
    const payload = message.payload as BrowserBudBridgeHighlightMessage['payload'];
    if (
      payload
      && typeof payload.requestId === 'string'
      && typeof payload.ok === 'boolean'
      && typeof payload.url === 'string'
    ) {
      return {
        kind: 'highlight',
        response: {
          requestId: payload.requestId,
          ok: payload.ok,
          url: payload.url,
          anchorId: typeof payload.anchorId === 'string' ? payload.anchorId : null,
          matchedName: typeof payload.matchedName === 'string' ? payload.matchedName : null,
          matchedRole: typeof payload.matchedRole === 'string' ? payload.matchedRole : null,
          error: typeof payload.error === 'string' ? payload.error : null,
        },
      };
    }
  }

  return null;
}

export function postBrowserBudBridgeRequest(
  type: BrowserBudBridgeRequestType,
  payload?: BrowserBudBridgeRequest['payload'],
) {
  if (typeof window === 'undefined') {
    return;
  }

  window.postMessage(createBrowserBudBridgeRequest(type, payload), window.location.origin);
}

export function subscribeToBrowserBudBridge(
  onEvent: (event: BrowserBudBridgeEvent) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleMessage = (event: MessageEvent) => {
    if (event.source !== window) {
      return;
    }

    const parsed = parseBrowserBudBridgeMessage(event.data);
    if (parsed) {
      onEvent(parsed);
    }
  };

  window.addEventListener('message', handleMessage);
  return () => {
    window.removeEventListener('message', handleMessage);
  };
}

export function requestBrowserBudPageResource(
  url: string,
  timeoutMs = 20000,
): Promise<BrowserBudPageResourceResponse | null> {
  if (typeof window === 'undefined' || !url) {
    return Promise.resolve(null);
  }

  const requestId = `page-resource-${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);

    const cleanup = subscribeToBrowserBudBridge((event) => {
      if (event.kind !== 'resource' || event.response.requestId !== requestId) {
        return;
      }

      window.clearTimeout(timeout);
      cleanup();
      resolve(event.response);
    });

    window.postMessage(
      createBrowserBudBridgeRequest('REQUEST_PAGE_RESOURCE', {
        requestId,
        url,
      }),
      window.location.origin,
    );
  });
}

export function requestBrowserBudElementHighlight(
  payload: {
    anchorId?: string;
    name?: string;
    role?: string;
    nearbyHeading?: string;
    selectorHints?: string[];
    scrollIntoView?: boolean;
  },
  timeoutMs = 8000,
): Promise<BrowserBudHighlightResponse | null> {
  if (typeof window === 'undefined') {
    return Promise.resolve(null);
  }

  const requestId = `highlight-${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);

    const cleanup = subscribeToBrowserBudBridge((event) => {
      if (event.kind !== 'highlight' || event.response.requestId !== requestId) {
        return;
      }

      window.clearTimeout(timeout);
      cleanup();
      resolve(event.response);
    });

    window.postMessage(
      createBrowserBudBridgeRequest('HIGHLIGHT_PAGE_ELEMENT', {
        requestId,
        anchorId: payload.anchorId,
        name: payload.name,
        role: payload.role,
        nearbyHeading: payload.nearbyHeading,
        selectorHints: payload.selectorHints,
        scrollIntoView: payload.scrollIntoView !== false,
      }),
      window.location.origin,
    );
  });
}
