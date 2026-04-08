import { isBrowserContextPacket, type BrowserContextPacket } from './browserContext';

export type BrowserBudBridgeRequestType = 'REQUEST_ACTIVE_CONTEXT' | 'REQUEST_EXTENSION_STATUS';

type BrowserBudBridgeRequest = {
  source: 'browserbud-app';
  type: `BROWSERBUD_${BrowserBudBridgeRequestType}`;
};

type BrowserBudBridgeReadyMessage = {
  source: 'browserbud-extension';
  type: 'BROWSERBUD_EXTENSION_READY';
  payload?: {
    version?: string;
  };
};

type BrowserBudBridgePacketMessage = {
  source: 'browserbud-extension';
  type: 'BROWSERBUD_CONTEXT_PACKET';
  payload: BrowserContextPacket;
};

export type BrowserBudBridgeEvent =
  | { kind: 'ready'; version: string }
  | { kind: 'packet'; packet: BrowserContextPacket };

export function createBrowserBudBridgeRequest(type: BrowserBudBridgeRequestType): BrowserBudBridgeRequest {
  return {
    source: 'browserbud-app',
    type: `BROWSERBUD_${type}`,
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

  if (message.type === 'BROWSERBUD_CONTEXT_PACKET' && isBrowserContextPacket(message.payload)) {
    return {
      kind: 'packet',
      packet: message.payload,
    };
  }

  return null;
}

export function postBrowserBudBridgeRequest(type: BrowserBudBridgeRequestType) {
  if (typeof window === 'undefined') {
    return;
  }

  window.postMessage(createBrowserBudBridgeRequest(type), window.location.origin);
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
