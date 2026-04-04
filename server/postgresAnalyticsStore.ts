import postgres, { type Sql } from 'postgres';

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
import type { AnalyticsStoreAdapter } from './analyticsBackend';
import { buildSessionRecapMarkdown, buildSessionRecapPayload } from './sessionRecap';

type PostgresAnalyticsStoreOptions = {
  connectionString: string;
};

type SessionRow = {
  id: string;
  started_at: string;
  ended_at: string | null;
  source_surface: string | null;
  persona_id: string | null;
  live_model: string | null;
  search_enabled: boolean;
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
  payload_json: unknown;
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
  source_event_ids_json: unknown;
  source_turn_ids_json: unknown;
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
  json_payload: unknown;
  model_name: string;
  created_at: string;
};

function parseJsonValue<TValue>(value: unknown, fallback: TValue): TValue {
  if (value == null) {
    return fallback;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as TValue;
    } catch {
      return fallback;
    }
  }

  return value as TValue;
}

function toPostgresJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

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
    payload: parseJsonValue<Record<string, unknown>>(row.payload_json, {}),
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
    sourceEventIds: parseJsonValue<string[]>(row.source_event_ids_json, []),
    sourceTurnIds: parseJsonValue<string[]>(row.source_turn_ids_json, []),
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
    jsonPayload: parseJsonValue<TPayload>(row.json_payload, {} as TPayload),
    modelName: row.model_name,
    createdAt: row.created_at,
  };
}

const SCHEMA_SQL = `
create table if not exists sessions (
  id text primary key,
  started_at text not null,
  ended_at text,
  source_surface text,
  persona_id text,
  live_model text,
  search_enabled boolean not null default false,
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
  payload_json jsonb not null default '{}'::jsonb,
  privacy_tier text not null default 'standard'
);

create index if not exists raw_events_session_time_idx on raw_events(session_id, occurred_at, seq);
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
  source_event_ids_json jsonb not null default '[]'::jsonb,
  source_turn_ids_json jsonb not null default '[]'::jsonb,
  embedding_model text,
  embedding_json text,
  created_at text not null
);

create index if not exists memories_session_type_idx on memories(session_id, memory_type, created_at desc);

create table if not exists summaries (
  id text primary key,
  session_id text references sessions(id) on delete set null,
  period_type text not null,
  period_start text not null,
  period_end text not null,
  summary_kind text not null,
  markdown text not null,
  json_payload jsonb not null,
  model_name text not null,
  created_at text not null
);

create index if not exists summaries_session_created_idx on summaries(session_id, created_at desc);
`;

export class PostgresAnalyticsStore implements AnalyticsStoreAdapter {
  private readonly sql: Sql;

  constructor(options: PostgresAnalyticsStoreOptions) {
    this.sql = postgres(options.connectionString, {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
  }

  async initialize() {
    await this.sql.unsafe(SCHEMA_SQL);
  }

  async close() {
    await this.sql.end({ timeout: 5 });
  }

  async createSession(input: AnalyticsSessionCreateInput): Promise<AnalyticsSessionRecord> {
    const id = input.id || crypto.randomUUID();
    const createdAt = new Date().toISOString();

    await this.sql`
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
        ${id},
        ${input.startedAt},
        null,
        ${input.sourceSurface || null},
        ${input.personaId || null},
        ${input.liveModel || null},
        ${Boolean(input.searchEnabled)},
        ${input.captureMode},
        ${createdAt}
      )
    `;

    return this.getSession(id);
  }

  async getSession(sessionId: string): Promise<AnalyticsSessionRecord> {
    const [row] = await this.sql<SessionRow[]>`
      select * from sessions where id = ${sessionId}
    `;
    if (!row) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return toSessionRecord(row);
  }

  async completeSession(sessionId: string, endedAt: string): Promise<AnalyticsSessionRecord> {
    await this.sql`
      update sessions
      set ended_at = ${endedAt}
      where id = ${sessionId}
    `;
    return this.getSession(sessionId);
  }

  async appendRawEvent(input: AnalyticsRawEventInput): Promise<AnalyticsRawEventRecord> {
    const id = input.id || crypto.randomUUID();

    await this.sql`
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
        ${id},
        ${input.sessionId},
        ${input.seq},
        ${input.source},
        ${input.eventType},
        ${input.occurredAt},
        ${input.endedAt || null},
        ${input.appName || null},
        ${input.windowTitle || null},
        ${input.tabId || null},
        ${input.url || null},
        ${input.domain || null},
        ${input.pageTitle || null},
        ${toPostgresJson(input.payload || {})}::jsonb,
        ${input.privacyTier || 'standard'}
      )
    `;

    const [row] = await this.sql<RawEventRow[]>`
      select * from raw_events where id = ${id}
    `;
    return toRawEventRecord(row);
  }

  async saveConversationTurn(input: AnalyticsConversationTurnInput): Promise<AnalyticsConversationTurnRecord> {
    const id = input.id || crypto.randomUUID();

    await this.sql`
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
        ${id},
        ${input.sessionId},
        ${input.role},
        ${input.startedAt},
        ${input.endedAt || null},
        ${input.transcript},
        ${input.promptKind || null},
        ${input.modelName || null},
        ${input.relatedEventId || null}
      )
    `;

    const [row] = await this.sql<TurnRow[]>`
      select * from conversation_turns where id = ${id}
    `;
    return toTurnRecord(row);
  }

  async saveMemory(input: AnalyticsMemoryInput): Promise<AnalyticsMemoryRecord> {
    const id = input.id || crypto.randomUUID();
    const createdAt = new Date().toISOString();

    await this.sql`
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
        ${id},
        ${input.sessionId},
        ${input.memoryType},
        ${input.title},
        ${input.bodyMd},
        ${input.sourceUrl || null},
        ${toPostgresJson(input.sourceEventIds || [])}::jsonb,
        ${toPostgresJson(input.sourceTurnIds || [])}::jsonb,
        ${input.embeddingModel || null},
        ${input.embeddingJson || null},
        ${createdAt}
      )
    `;

    const [row] = await this.sql<MemoryRow[]>`
      select * from memories where id = ${id}
    `;
    return toMemoryRecord(row);
  }

  async listSessionTimeline(sessionId: string): Promise<AnalyticsSessionTimeline> {
    const session = await this.getSession(sessionId);

    const [events, turns, memories, summaries] = await Promise.all([
      this.sql<RawEventRow[]>`
        select * from raw_events
        where session_id = ${sessionId}
        order by occurred_at asc, seq asc
      `,
      this.sql<TurnRow[]>`
        select * from conversation_turns
        where session_id = ${sessionId}
        order by started_at asc
      `,
      this.sql<MemoryRow[]>`
        select * from memories
        where session_id = ${sessionId}
        order by created_at desc
      `,
      this.sql<SummaryRow[]>`
        select * from summaries
        where session_id = ${sessionId}
        order by created_at desc
      `,
    ]);

    return {
      session,
      events: events.map(toRawEventRecord),
      turns: turns.map(toTurnRecord),
      memories: memories.map(toMemoryRecord),
      summaries: summaries.map((row) => toSummaryRecord(row)),
    };
  }

  async listRecentSessions(limit = 10): Promise<AnalyticsSessionListItem[]> {
    const sessions = (await this.sql<SessionRow[]>`
      select * from sessions
      order by started_at desc
      limit ${limit}
    `).map(toSessionRecord);

    const items = await Promise.all(
      sessions.map(async (session) => {
        const [summaryRow] = await this.sql<SummaryRow[]>`
          select * from summaries
          where session_id = ${session.id}
          order by created_at desc
          limit 1
        `;
        return {
          session,
          latestSummary: summaryRow ? toSummaryRecord(summaryRow) : null,
        } satisfies AnalyticsSessionListItem;
      }),
    );

    return items;
  }

  async getLatestSessionTimeline(): Promise<AnalyticsSessionTimeline> {
    const [latestSession] = await this.sql<SessionRow[]>`
      select * from sessions
      order by started_at desc
      limit 1
    `;

    if (!latestSession) {
      throw new Error('No analytics sessions found.');
    }

    return this.listSessionTimeline(latestSession.id);
  }

  async generateSessionRecap(sessionId: string): Promise<AnalyticsSummaryRecord<SessionRecapPayload>> {
    const timeline = await this.listSessionTimeline(sessionId);
    const payload = buildSessionRecapPayload({
      session: timeline.session,
      events: timeline.events,
      turns: timeline.turns,
      memories: timeline.memories,
    });
    const markdown = buildSessionRecapMarkdown(payload);
    const createdAt = new Date().toISOString();
    const summaryId = crypto.randomUUID();

    await this.sql`
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
        ${summaryId},
        ${sessionId},
        ${'session'},
        ${timeline.session.startedAt},
        ${timeline.session.endedAt || timeline.session.startedAt},
        ${'session_recap'},
        ${markdown},
        ${toPostgresJson(payload)}::jsonb,
        ${'heuristic-local'},
        ${createdAt}
      )
    `;

    const [row] = await this.sql<SummaryRow[]>`
      select * from summaries where id = ${summaryId}
    `;
    return toSummaryRecord<SessionRecapPayload>(row);
  }
}
