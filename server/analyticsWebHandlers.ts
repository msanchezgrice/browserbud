import type {
  AnalyticsConversationTurnInput,
  AnalyticsMemoryInput,
  AnalyticsRawEventInput,
  AnalyticsSessionCreateInput,
} from '../src/analyticsTypes';
import { AnalyticsBackendUnavailableError, type AnalyticsStoreAdapter } from './analyticsBackend';
import { getAnalyticsStore } from './analyticsRuntime';

function corsHeaders(extraHeaders: Record<string, string> = {}): HeadersInit {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
    'access-control-allow-headers': 'Content-Type',
    'cache-control': 'no-store',
    ...extraHeaders,
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: corsHeaders({ 'content-type': 'application/json' }),
  });
}

function emptyResponse(status = 204): Response {
  return new Response(null, {
    status,
    headers: corsHeaders(),
  });
}

function methodNotAllowed(allowedMethods: string[]): Response {
  return jsonResponse({ error: `Method not allowed. Use ${allowedMethods.join(', ')}.` }, 405);
}

async function getStore(store?: AnalyticsStoreAdapter): Promise<AnalyticsStoreAdapter> {
  return store || await getAnalyticsStore();
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  if (request.method === 'GET' || request.method === 'OPTIONS') {
    return {};
  }

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return {};
  }

  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function optionalStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function getPathSegments(request: Request): string[] {
  return new URL(request.url).pathname.split('/').filter(Boolean);
}

function getSessionIdFromRequest(request: Request): string {
  const segments = getPathSegments(request);
  return requireString(segments[3], 'sessionId');
}

async function runHandler(handler: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected analytics API error.';
    const status = error instanceof AnalyticsBackendUnavailableError ? error.status : 400;
    return jsonResponse({ error: message }, status);
  }
}

export async function handleAnalyticsSessionsRequest(request: Request, store?: AnalyticsStoreAdapter): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return emptyResponse();
  }

  return runHandler(async () => {
    const analyticsStore = await getStore(store);
    if (request.method === 'GET') {
      const { searchParams } = new URL(request.url);
      const rawLimit = Number(searchParams.get('limit') || 10);
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 50) : 10;
      return jsonResponse({ sessions: await analyticsStore.listRecentSessions(limit) });
    }

    if (request.method === 'POST') {
      const body = await readJsonBody(request);
      const session = await analyticsStore.createSession({
        id: optionalString(body.id) || undefined,
        startedAt: requireString(body.startedAt, 'startedAt'),
        sourceSurface: optionalString(body.sourceSurface),
        personaId: optionalString(body.personaId),
        liveModel: optionalString(body.liveModel),
        searchEnabled: Boolean(body.searchEnabled),
        captureMode: requireString(body.captureMode, 'captureMode'),
      } satisfies AnalyticsSessionCreateInput);

      return jsonResponse({ session }, 201);
    }

    return methodNotAllowed(['GET', 'POST']);
  });
}

export async function handleAnalyticsSessionRequest(request: Request, store?: AnalyticsStoreAdapter): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return emptyResponse();
  }

  return runHandler(async () => {
    if (request.method !== 'PATCH') {
      return methodNotAllowed(['PATCH']);
    }

    const analyticsStore = await getStore(store);
    const body = await readJsonBody(request);
    const session = await analyticsStore.completeSession(
      getSessionIdFromRequest(request),
      requireString(body.endedAt, 'endedAt'),
    );

    return jsonResponse({ session });
  });
}

export async function handleAnalyticsEventsRequest(request: Request, store?: AnalyticsStoreAdapter): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return emptyResponse();
  }

  return runHandler(async () => {
    if (request.method !== 'POST') {
      return methodNotAllowed(['POST']);
    }

    const analyticsStore = await getStore(store);
    const body = await readJsonBody(request);
    const event = await analyticsStore.appendRawEvent({
      id: optionalString(body.id) || undefined,
      sessionId: requireString(body.sessionId, 'sessionId'),
      seq: Number(body.seq),
      source: requireString(body.source, 'source'),
      eventType: requireString(body.eventType, 'eventType'),
      occurredAt: requireString(body.occurredAt, 'occurredAt'),
      endedAt: optionalString(body.endedAt),
      appName: optionalString(body.appName),
      windowTitle: optionalString(body.windowTitle),
      tabId: optionalString(body.tabId),
      url: optionalString(body.url),
      domain: optionalString(body.domain),
      pageTitle: optionalString(body.pageTitle),
      payload: typeof body.payload === 'object' && body.payload !== null ? body.payload as Record<string, unknown> : {},
      privacyTier: optionalString(body.privacyTier) || 'standard',
    } satisfies AnalyticsRawEventInput);

    return jsonResponse({ event }, 201);
  });
}

export async function handleAnalyticsTurnsRequest(request: Request, store?: AnalyticsStoreAdapter): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return emptyResponse();
  }

  return runHandler(async () => {
    if (request.method !== 'POST') {
      return methodNotAllowed(['POST']);
    }

    const analyticsStore = await getStore(store);
    const body = await readJsonBody(request);
    const turn = await analyticsStore.saveConversationTurn({
      id: optionalString(body.id) || undefined,
      sessionId: requireString(body.sessionId, 'sessionId'),
      role: requireString(body.role, 'role'),
      startedAt: requireString(body.startedAt, 'startedAt'),
      endedAt: optionalString(body.endedAt),
      transcript: requireString(body.transcript, 'transcript'),
      promptKind: optionalString(body.promptKind),
      modelName: optionalString(body.modelName),
      relatedEventId: optionalString(body.relatedEventId),
    } satisfies AnalyticsConversationTurnInput);

    return jsonResponse({ turn }, 201);
  });
}

export async function handleAnalyticsMemoriesRequest(request: Request, store?: AnalyticsStoreAdapter): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return emptyResponse();
  }

  return runHandler(async () => {
    if (request.method !== 'POST') {
      return methodNotAllowed(['POST']);
    }

    const analyticsStore = await getStore(store);
    const body = await readJsonBody(request);
    const memory = await analyticsStore.saveMemory({
      id: optionalString(body.id) || undefined,
      sessionId: requireString(body.sessionId, 'sessionId'),
      memoryType: requireString(body.memoryType, 'memoryType'),
      title: requireString(body.title, 'title'),
      bodyMd: requireString(body.bodyMd, 'bodyMd'),
      sourceUrl: optionalString(body.sourceUrl),
      sourceEventIds: optionalStringArray(body.sourceEventIds),
      sourceTurnIds: optionalStringArray(body.sourceTurnIds),
      embeddingModel: optionalString(body.embeddingModel),
      embeddingJson: optionalString(body.embeddingJson),
    } satisfies AnalyticsMemoryInput);

    return jsonResponse({ memory }, 201);
  });
}

export async function handleLatestAnalyticsSessionTimelineRequest(request: Request, store?: AnalyticsStoreAdapter): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return emptyResponse();
  }

  return runHandler(async () => {
    if (request.method !== 'GET') {
      return methodNotAllowed(['GET']);
    }

    return jsonResponse(await (await getStore(store)).getLatestSessionTimeline());
  });
}

export async function handleAnalyticsSessionTimelineRequest(request: Request, store?: AnalyticsStoreAdapter): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return emptyResponse();
  }

  return runHandler(async () => {
    if (request.method !== 'GET') {
      return methodNotAllowed(['GET']);
    }

    return jsonResponse(await (await getStore(store)).listSessionTimeline(getSessionIdFromRequest(request)));
  });
}

export async function handleAnalyticsSessionRecapRequest(request: Request, store?: AnalyticsStoreAdapter): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return emptyResponse();
  }

  return runHandler(async () => {
    if (request.method !== 'POST') {
      return methodNotAllowed(['POST']);
    }

    const analyticsStore = await getStore(store);
    const sessionId = getSessionIdFromRequest(request);
    const body = await readJsonBody(request);
    const endedAt = optionalString(body.endedAt);
    if (endedAt) {
      await analyticsStore.completeSession(sessionId, endedAt);
    }

    return jsonResponse({ summary: await analyticsStore.generateSessionRecap(sessionId) });
  });
}
