import { mkdirSync } from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import type {
  AnalyticsConversationTurnInput,
  AnalyticsConversationTurnRecord,
  AnalyticsMemoryInput,
  AnalyticsMemoryRecord,
  AnalyticsRawEventInput,
  AnalyticsRawEventRecord,
  AnalyticsSessionCreateInput,
  AnalyticsSessionListItem,
  AnalyticsSessionRecord,
  AnalyticsSessionTimeline,
  AnalyticsSummaryRecord,
  SessionRecapPayload,
} from '../src/analyticsTypes';
import { buildSessionRecapMarkdown, buildSessionRecapPayload } from './sessionRecap';

type AnalyticsStoreOptions = {
  dbPath: string;
};

type SessionRow = {
  id: string;
  started_at: string;
  ended_at: string | null;
  source_surface: string | null;
  persona_id: string | null;
  live_model: string | null;
  search_enabled: number;
  capture_mode: string;
  created_at: string;
};

type RawEventRow = {
  id: string;
  session_id: string;
  seq: number;
  source: string;
  event_type: string;
  occurred_at: string;
  ended_at: string | null;
  app_name: string | null;
  window_title: string | null;
  tab_id: string | null;
  url: string | null;
  domain: string | null;
  page_title: string | null;
  payload_json: string;
  privacy_tier: string;
};

type TurnRow = {
  id: string;
  session_id: string;
  role: string;
  started_at: string;
  ended_at: string | null;
  transcript: string;
  prompt_kind: string | null;
  model_name: string | null;
  related_event_id: string | null;
};

type MemoryRow = {
  id: string;
  session_id: string;
  memory_type: string;
  title: string;
  body_md: string;
  source_url: string | null;
  source_event_ids_json: string;
  source_turn_ids_json: string;
  embedding_model: string | null;
  embedding_json: string | null;
  created_at: string;
};

type SummaryRow = {
  id: string;
  session_id: string | null;
  period_type: string;
  period_start: string;
  period_end: string;
  summary_kind: string;
  markdown: string;
  json_payload: string;
  model_name: string;
  created_at: string;
};

function toSessionRecord(row: SessionRow): AnalyticsSessionRecord {
  return {
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    sourceSurface: row.source_surface,
    personaId: row.persona_id,
    liveModel: row.live_model,
    searchEnabled: Boolean(row.search_enabled),
    captureMode: row.capture_mode,
    createdAt: row.created_at,
  };
}

function toRawEventRecord(row: RawEventRow): AnalyticsRawEventRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    seq: row.seq,
    source: row.source,
    eventType: row.event_type,
    occurredAt: row.occurred_at,
    endedAt: row.ended_at,
    appName: row.app_name,
    windowTitle: row.window_title,
    tabId: row.tab_id,
    url: row.url,
    domain: row.domain,
    pageTitle: row.page_title,
    payload: JSON.parse(row.payload_json || '{}'),
    privacyTier: row.privacy_tier,
  };
}

function toTurnRecord(row: TurnRow): AnalyticsConversationTurnRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    transcript: row.transcript,
    promptKind: row.prompt_kind,
    modelName: row.model_name,
    relatedEventId: row.related_event_id,
  };
}

function toMemoryRecord(row: MemoryRow): AnalyticsMemoryRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    memoryType: row.memory_type,
    title: row.title,
    bodyMd: row.body_md,
    sourceUrl: row.source_url,
    sourceEventIds: JSON.parse(row.source_event_ids_json || '[]'),
    sourceTurnIds: JSON.parse(row.source_turn_ids_json || '[]'),
    embeddingModel: row.embedding_model,
    embeddingJson: row.embedding_json,
    createdAt: row.created_at,
  };
}

function toSummaryRecord<TPayload = Record<string, unknown>>(row: SummaryRow): AnalyticsSummaryRecord<TPayload> {
  return {
    id: row.id,
    sessionId: row.session_id,
    periodType: row.period_type,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    summaryKind: row.summary_kind,
    markdown: row.markdown,
    jsonPayload: JSON.parse(row.json_payload) as TPayload,
    modelName: row.model_name,
    createdAt: row.created_at,
  };
}

const SCHEMA_SQL = `
pragma foreign_keys = on;

create table if not exists sessions (
  id text primary key,
  started_at text not null,
  ended_at text,
  source_surface text,
  persona_id text,
  live_model text,
  search_enabled integer not null default 0,
  capture_mode text not null,
  created_at text not null
);

create table if not exists raw_events (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  seq integer not null,
  source text not null,
  event_type text not null,
  occurred_at text not null,
  ended_at text,
  app_name text,
  window_title text,
  tab_id text,
  url text,
  domain text,
  page_title text,
  payload_json text not null,
  privacy_tier text not null default 'standard'
);

create index if not exists raw_events_session_time_idx on raw_events(session_id, occurred_at);
create index if not exists raw_events_type_time_idx on raw_events(event_type, occurred_at);
create index if not exists raw_events_domain_idx on raw_events(domain, occurred_at);

create table if not exists conversation_turns (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  role text not null,
  started_at text not null,
  ended_at text,
  transcript text not null,
  prompt_kind text,
  model_name text,
  related_event_id text references raw_events(id) on delete set null
);

create index if not exists conversation_turns_session_time_idx on conversation_turns(session_id, started_at);

create table if not exists memories (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  memory_type text not null,
  title text not null,
  body_md text not null,
  source_url text,
  source_event_ids_json text not null,
  source_turn_ids_json text not null,
  embedding_model text,
  embedding_json text,
  created_at text not null
);

create index if not exists memories_session_type_idx on memories(session_id, memory_type, created_at);

create table if not exists summaries (
  id text primary key,
  session_id text references sessions(id) on delete set null,
  period_type text not null,
  period_start text not null,
  period_end text not null,
  summary_kind text not null,
  markdown text not null,
  json_payload text not null,
  model_name text not null,
  created_at text not null
);

create table if not exists recommendations (
  id text primary key,
  session_id text references sessions(id) on delete set null,
  created_at text not null,
  recommendation_kind text not null,
  priority integer not null default 0,
  title text not null,
  rationale_md text not null,
  action_json text,
  status text not null default 'open'
);

create table if not exists deliveries (
  id text primary key,
  summary_id text not null references summaries(id) on delete cascade,
  channel text not null,
  destination text,
  status text not null,
  sent_at text,
  error_text text
);
`;

export class AnalyticsStore {
  private readonly db: Database.Database;

  constructor(options: AnalyticsStoreOptions) {
    mkdirSync(path.dirname(options.dbPath), { recursive: true });
    this.db = new Database(options.dbPath);
    this.db.pragma('foreign_keys = ON');
  }

  initialize() {
    this.db.exec(SCHEMA_SQL);
  }

  close() {
    this.db.close();
  }

  createSession(input: AnalyticsSessionCreateInput): AnalyticsSessionRecord {
    const id = input.id || crypto.randomUUID();
    const createdAt = new Date().toISOString();

    this.db.prepare(`
      insert into sessions (
        id,
        started_at,
        ended_at,
        source_surface,
        persona_id,
        live_model,
        search_enabled,
        capture_mode,
        created_at
      ) values (
        @id,
        @started_at,
        null,
        @source_surface,
        @persona_id,
        @live_model,
        @search_enabled,
        @capture_mode,
        @created_at
      )
    `).run({
      id,
      started_at: input.startedAt,
      source_surface: input.sourceSurface || null,
      persona_id: input.personaId || null,
      live_model: input.liveModel || null,
      search_enabled: input.searchEnabled ? 1 : 0,
      capture_mode: input.captureMode,
      created_at: createdAt,
    });

    return this.getSession(id);
  }

  getSession(sessionId: string): AnalyticsSessionRecord {
    const row = this.db.prepare('select * from sessions where id = ?').get(sessionId) as SessionRow | undefined;
    if (!row) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return toSessionRecord(row);
  }

  completeSession(sessionId: string, endedAt: string): AnalyticsSessionRecord {
    this.db.prepare('update sessions set ended_at = ? where id = ?').run(endedAt, sessionId);
    return this.getSession(sessionId);
  }

  appendRawEvent(input: AnalyticsRawEventInput): AnalyticsRawEventRecord {
    const id = input.id || crypto.randomUUID();
    this.db.prepare(`
      insert into raw_events (
        id,
        session_id,
        seq,
        source,
        event_type,
        occurred_at,
        ended_at,
        app_name,
        window_title,
        tab_id,
        url,
        domain,
        page_title,
        payload_json,
        privacy_tier
      ) values (
        @id,
        @session_id,
        @seq,
        @source,
        @event_type,
        @occurred_at,
        @ended_at,
        @app_name,
        @window_title,
        @tab_id,
        @url,
        @domain,
        @page_title,
        @payload_json,
        @privacy_tier
      )
    `).run({
      id,
      session_id: input.sessionId,
      seq: input.seq,
      source: input.source,
      event_type: input.eventType,
      occurred_at: input.occurredAt,
      ended_at: input.endedAt || null,
      app_name: input.appName || null,
      window_title: input.windowTitle || null,
      tab_id: input.tabId || null,
      url: input.url || null,
      domain: input.domain || null,
      page_title: input.pageTitle || null,
      payload_json: JSON.stringify(input.payload || {}),
      privacy_tier: input.privacyTier || 'standard',
    });

    const row = this.db.prepare('select * from raw_events where id = ?').get(id) as RawEventRow;
    return toRawEventRecord(row);
  }

  saveConversationTurn(input: AnalyticsConversationTurnInput): AnalyticsConversationTurnRecord {
    const id = input.id || crypto.randomUUID();
    this.db.prepare(`
      insert into conversation_turns (
        id,
        session_id,
        role,
        started_at,
        ended_at,
        transcript,
        prompt_kind,
        model_name,
        related_event_id
      ) values (
        @id,
        @session_id,
        @role,
        @started_at,
        @ended_at,
        @transcript,
        @prompt_kind,
        @model_name,
        @related_event_id
      )
    `).run({
      id,
      session_id: input.sessionId,
      role: input.role,
      started_at: input.startedAt,
      ended_at: input.endedAt || null,
      transcript: input.transcript,
      prompt_kind: input.promptKind || null,
      model_name: input.modelName || null,
      related_event_id: input.relatedEventId || null,
    });

    const row = this.db.prepare('select * from conversation_turns where id = ?').get(id) as TurnRow;
    return toTurnRecord(row);
  }

  saveMemory(input: AnalyticsMemoryInput): AnalyticsMemoryRecord {
    const id = input.id || crypto.randomUUID();
    const createdAt = new Date().toISOString();

    this.db.prepare(`
      insert into memories (
        id,
        session_id,
        memory_type,
        title,
        body_md,
        source_url,
        source_event_ids_json,
        source_turn_ids_json,
        embedding_model,
        embedding_json,
        created_at
      ) values (
        @id,
        @session_id,
        @memory_type,
        @title,
        @body_md,
        @source_url,
        @source_event_ids_json,
        @source_turn_ids_json,
        @embedding_model,
        @embedding_json,
        @created_at
      )
    `).run({
      id,
      session_id: input.sessionId,
      memory_type: input.memoryType,
      title: input.title,
      body_md: input.bodyMd,
      source_url: input.sourceUrl || null,
      source_event_ids_json: JSON.stringify(input.sourceEventIds || []),
      source_turn_ids_json: JSON.stringify(input.sourceTurnIds || []),
      embedding_model: input.embeddingModel || null,
      embedding_json: input.embeddingJson || null,
      created_at: createdAt,
    });

    const row = this.db.prepare('select * from memories where id = ?').get(id) as MemoryRow;
    return toMemoryRecord(row);
  }

  listSessionTimeline(sessionId: string): AnalyticsSessionTimeline {
    const session = this.getSession(sessionId);

    const events = (this.db.prepare('select * from raw_events where session_id = ? order by occurred_at asc, seq asc').all(sessionId) as RawEventRow[])
      .map(toRawEventRecord);
    const turns = (this.db.prepare('select * from conversation_turns where session_id = ? order by started_at asc').all(sessionId) as TurnRow[])
      .map(toTurnRecord);
    const memories = (this.db.prepare('select * from memories where session_id = ? order by created_at desc').all(sessionId) as MemoryRow[])
      .map(toMemoryRecord);
    const summaries = (this.db.prepare('select * from summaries where session_id = ? order by created_at desc').all(sessionId) as SummaryRow[])
      .map((row) => toSummaryRecord(row));

    return {
      session,
      events,
      turns,
      memories,
      summaries,
    };
  }

  listRecentSessions(limit = 10): AnalyticsSessionListItem[] {
    const sessions = (this.db.prepare(`
      select *
      from sessions
      order by started_at desc
      limit ?
    `).all(limit) as SessionRow[]).map(toSessionRecord);

    const latestSummaryForSession = this.db.prepare(`
      select *
      from summaries
      where session_id = ?
      order by created_at desc
      limit 1
    `);

    return sessions.map((session) => {
      const summaryRow = latestSummaryForSession.get(session.id) as SummaryRow | undefined;
      return {
        session,
        latestSummary: summaryRow ? toSummaryRecord(summaryRow) : null,
      };
    });
  }

  getLatestSessionTimeline(): AnalyticsSessionTimeline {
    const latestSession = this.db.prepare(`
      select *
      from sessions
      order by started_at desc
      limit 1
    `).get() as SessionRow | undefined;

    if (!latestSession) {
      throw new Error('No analytics sessions found.');
    }

    return this.listSessionTimeline(latestSession.id);
  }

  generateSessionRecap(sessionId: string): AnalyticsSummaryRecord<SessionRecapPayload> {
    const timeline = this.listSessionTimeline(sessionId);
    const payload = buildSessionRecapPayload({
      session: timeline.session,
      events: timeline.events,
      turns: timeline.turns,
      memories: timeline.memories,
    });
    const markdown = buildSessionRecapMarkdown(payload);
    const createdAt = new Date().toISOString();
    const summaryId = crypto.randomUUID();

    this.db.prepare(`
      insert into summaries (
        id,
        session_id,
        period_type,
        period_start,
        period_end,
        summary_kind,
        markdown,
        json_payload,
        model_name,
        created_at
      ) values (
        @id,
        @session_id,
        @period_type,
        @period_start,
        @period_end,
        @summary_kind,
        @markdown,
        @json_payload,
        @model_name,
        @created_at
      )
    `).run({
      id: summaryId,
      session_id: sessionId,
      period_type: 'session',
      period_start: timeline.session.startedAt,
      period_end: timeline.session.endedAt || timeline.session.startedAt,
      summary_kind: 'session_recap',
      markdown,
      json_payload: JSON.stringify(payload),
      model_name: 'heuristic-local',
      created_at: createdAt,
    });

    const row = this.db.prepare('select * from summaries where id = ?').get(summaryId) as SummaryRow;
    return toSummaryRecord<SessionRecapPayload>(row);
  }
}
