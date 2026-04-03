import type {
  AnalyticsConversationTurnInput,
  AnalyticsSessionListItem,
  AnalyticsMemoryInput,
  AnalyticsRawEventInput,
  AnalyticsSessionCreateInput,
  AnalyticsSessionTimeline,
  AnalyticsSummaryRecord,
  SessionRecapPayload,
} from './analyticsTypes';

const ANALYTICS_API_URL = process.env.BROWSERBUD_LOCAL_API_URL || 'http://127.0.0.1:3011/api/analytics';

async function request<TResponse>(pathname: string, init?: RequestInit): Promise<TResponse | null> {
  try {
    const response = await fetch(`${ANALYTICS_API_URL}${pathname}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init?.headers || {}),
      },
    });

    if (!response.ok) {
      console.warn('Browserbud analytics request failed', pathname, response.status);
      return null;
    }

    return await response.json() as TResponse;
  } catch (error) {
    console.debug('Browserbud analytics API unavailable', error);
    return null;
  }
}

export async function createAnalyticsSession(input: AnalyticsSessionCreateInput) {
  return request<{ session: { id: string } }>('/sessions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function completeAnalyticsSession(sessionId: string, endedAt: string) {
  return request<{ session: { id: string } }>(`/sessions/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ endedAt }),
  });
}

export async function recordAnalyticsEvent(input: AnalyticsRawEventInput) {
  return request<{ event: { id: string } }>('/events', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function recordAnalyticsTurn(input: AnalyticsConversationTurnInput) {
  return request<{ turn: { id: string } }>('/turns', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function recordAnalyticsMemory(input: AnalyticsMemoryInput) {
  return request<{ memory: { id: string } }>('/memories', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function generateAnalyticsSessionRecap(sessionId: string, endedAt: string) {
  return request<{ summary: AnalyticsSummaryRecord<SessionRecapPayload> }>(`/sessions/${sessionId}/recap`, {
    method: 'POST',
    body: JSON.stringify({ endedAt }),
  });
}

export async function fetchAnalyticsSessions(limit = 10) {
  return request<{ sessions: AnalyticsSessionListItem[] }>(`/sessions?limit=${limit}`);
}

export async function fetchAnalyticsSessionTimeline(sessionId: string) {
  return request<AnalyticsSessionTimeline>(`/sessions/${sessionId}/timeline`);
}

export async function fetchLatestAnalyticsSessionTimeline() {
  return request<AnalyticsSessionTimeline>('/sessions/latest/timeline');
}
