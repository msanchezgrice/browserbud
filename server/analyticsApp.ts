import express from 'express';

import type {
  AnalyticsConversationTurnInput,
  AnalyticsMemoryInput,
  AnalyticsRawEventInput,
  AnalyticsSessionCreateInput,
} from '../src/analyticsTypes';
import { AnalyticsStore } from './analyticsStore';

type CreateAnalyticsAppOptions = {
  store: AnalyticsStore;
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

  app.post('/api/analytics/sessions', (req, res, next) => {
    try {
      const body = req.body || {};
      const session = options.store.createSession({
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

  app.patch('/api/analytics/sessions/:sessionId', (req, res, next) => {
    try {
      const session = options.store.completeSession(
        requireString(req.params.sessionId, 'sessionId'),
        requireString(req.body?.endedAt, 'endedAt'),
      );
      res.json({ session });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/analytics/events', (req, res, next) => {
    try {
      const body = req.body || {};
      const event = options.store.appendRawEvent({
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

  app.post('/api/analytics/turns', (req, res, next) => {
    try {
      const body = req.body || {};
      const turn = options.store.saveConversationTurn({
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

  app.post('/api/analytics/memories', (req, res, next) => {
    try {
      const body = req.body || {};
      const memory = options.store.saveMemory({
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

  app.get('/api/analytics/sessions', (req, res, next) => {
    try {
      const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 10;
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 50) : 10;
      const sessions = options.store.listRecentSessions(limit);
      res.json({ sessions });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/analytics/sessions/latest/timeline', (_req, res, next) => {
    try {
      const timeline = options.store.getLatestSessionTimeline();
      res.json(timeline);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/analytics/sessions/:sessionId/timeline', (req, res, next) => {
    try {
      const timeline = options.store.listSessionTimeline(requireString(req.params.sessionId, 'sessionId'));
      res.json(timeline);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/analytics/sessions/:sessionId/recap', (req, res, next) => {
    try {
      const sessionId = requireString(req.params.sessionId, 'sessionId');
      const endedAt = optionalString(req.body?.endedAt);
      if (endedAt) {
        options.store.completeSession(sessionId, endedAt);
      }
      const summary = options.store.generateSessionRecap(sessionId);
      res.json({ summary });
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : 'Unexpected analytics API error.';
    res.status(400).json({ error: message });
  });

  return app;
}
