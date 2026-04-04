import express from 'express';

import type {
  AnalyticsConversationTurnInput,
  AnalyticsMemoryInput,
  AnalyticsRawEventInput,
  AnalyticsSessionCreateInput,
} from '../src/analyticsTypes';
import { AnalyticsBackendUnavailableError, type AnalyticsStoreAdapter } from './analyticsBackend.js';

type CreateAnalyticsAppOptions = {
  store: AnalyticsStoreAdapter;
};

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

export function createAnalyticsApp(options: CreateAnalyticsAppOptions) {
  const app = express();

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/analytics/sessions', async (req, res, next) => {
    try {
      const body = req.body || {};
      const session = await options.store.createSession({
        id: optionalString(body.id) || undefined,
        startedAt: requireString(body.startedAt, 'startedAt'),
        sourceSurface: optionalString(body.sourceSurface),
        personaId: optionalString(body.personaId),
        liveModel: optionalString(body.liveModel),
        searchEnabled: Boolean(body.searchEnabled),
        captureMode: requireString(body.captureMode, 'captureMode'),
      } satisfies AnalyticsSessionCreateInput);

      res.status(201).json({ session });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/analytics/sessions/:sessionId', async (req, res, next) => {
    try {
      const session = await options.store.completeSession(
        requireString(req.params.sessionId, 'sessionId'),
        requireString(req.body?.endedAt, 'endedAt'),
      );
      res.json({ session });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/analytics/events', async (req, res, next) => {
    try {
      const body = req.body || {};
      const event = await options.store.appendRawEvent({
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
        payload: typeof body.payload === 'object' && body.payload !== null ? body.payload : {},
        privacyTier: optionalString(body.privacyTier) || 'standard',
      } satisfies AnalyticsRawEventInput);

      res.status(201).json({ event });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/analytics/turns', async (req, res, next) => {
    try {
      const body = req.body || {};
      const turn = await options.store.saveConversationTurn({
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

      res.status(201).json({ turn });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/analytics/memories', async (req, res, next) => {
    try {
      const body = req.body || {};
      const memory = await options.store.saveMemory({
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

      res.status(201).json({ memory });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/analytics/sessions', async (req, res, next) => {
    try {
      const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 10;
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 50) : 10;
      const sessions = await options.store.listRecentSessions(limit);
      res.json({ sessions });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/analytics/sessions/latest/timeline', async (_req, res, next) => {
    try {
      const timeline = await options.store.getLatestSessionTimeline();
      res.json(timeline);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/analytics/sessions/:sessionId/timeline', async (req, res, next) => {
    try {
      const timeline = await options.store.listSessionTimeline(requireString(req.params.sessionId, 'sessionId'));
      res.json(timeline);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/analytics/sessions/:sessionId/recap', async (req, res, next) => {
    try {
      const sessionId = requireString(req.params.sessionId, 'sessionId');
      const endedAt = optionalString(req.body?.endedAt);
      if (endedAt) {
        await options.store.completeSession(sessionId, endedAt);
      }
      const summary = await options.store.generateSessionRecap(sessionId);
      res.json({ summary });
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : 'Unexpected analytics API error.';
    const status = error instanceof AnalyticsBackendUnavailableError ? error.status : 400;
    res.status(status).json({ error: message });
  });

  return app;
}
