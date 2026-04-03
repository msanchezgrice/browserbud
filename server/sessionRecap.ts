import type {
  AnalyticsConversationTurnRecord,
  AnalyticsMemoryRecord,
  AnalyticsRawEventRecord,
  AnalyticsSessionRecord,
  SessionRecapPayload,
} from '../src/analyticsTypes';

function incrementCounter(counter: Record<string, number>, key: string) {
  counter[key] = (counter[key] || 0) + 1;
}

function trimTranscript(text: string, maxLength = 160): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1)}...`;
}

export function buildSessionRecapPayload(input: {
  session: AnalyticsSessionRecord;
  events: AnalyticsRawEventRecord[];
  turns: AnalyticsConversationTurnRecord[];
  memories: AnalyticsMemoryRecord[];
}): SessionRecapPayload {
  const domainMap = new Map<string, { domain: string; eventCount: number; pageTitles: Set<string> }>();
  const turnCounts: Record<string, number> = {};
  const memoryCounts: Record<string, number> = {};

  for (const event of input.events) {
    const domain = event.domain?.trim();
    if (!domain) {
      continue;
    }

    const existing = domainMap.get(domain) || {
      domain,
      eventCount: 0,
      pageTitles: new Set<string>(),
    };
    existing.eventCount += 1;
    if (event.pageTitle?.trim()) {
      existing.pageTitles.add(event.pageTitle.trim());
    }
    domainMap.set(domain, existing);
  }

  for (const turn of input.turns) {
    incrementCounter(turnCounts, turn.role);
  }

  for (const memory of input.memories) {
    incrementCounter(memoryCounts, memory.memoryType);
  }

  const topMemories = input.memories.slice(0, 5).map((memory) => ({
    memoryType: memory.memoryType,
    title: memory.title,
    bodyMd: memory.bodyMd,
  }));

  const notableTurns = input.turns.slice(0, 4).map((turn) => ({
    role: turn.role,
    transcript: trimTranscript(turn.transcript),
  }));

  const domains = [...domainMap.values()]
    .sort((left, right) => right.eventCount - left.eventCount || left.domain.localeCompare(right.domain))
    .map((entry) => ({
      domain: entry.domain,
      eventCount: entry.eventCount,
      pageTitles: [...entry.pageTitles].sort(),
    }));

  return {
    sessionId: input.session.id,
    startedAt: input.session.startedAt,
    endedAt: input.session.endedAt,
    domains,
    turnCounts,
    memoryCounts,
    topMemories,
    notableTurns,
  };
}

export function buildSessionRecapMarkdown(payload: SessionRecapPayload): string {
  const lines: string[] = ['# Session Recap', ''];

  lines.push(`- **Session:** ${payload.sessionId}`);
  lines.push(`- **Started:** ${payload.startedAt}`);
  lines.push(`- **Ended:** ${payload.endedAt || 'In progress'}`);
  lines.push('');

  if (payload.domains.length > 0) {
    lines.push('## Sites Visited', '');
    for (const domain of payload.domains) {
      const titleSuffix = domain.pageTitles.length > 0
        ? ` (${domain.pageTitles.slice(0, 2).join('; ')})`
        : '';
      lines.push(`- **${domain.domain}**: ${domain.eventCount} events${titleSuffix}`);
    }
    lines.push('');
  }

  lines.push('## Conversation', '');
  if (Object.keys(payload.turnCounts).length === 0) {
    lines.push('- No conversation turns were saved.');
  } else {
    for (const [role, count] of Object.entries(payload.turnCounts).sort()) {
      lines.push(`- **${role}**: ${count}`);
    }
  }
  lines.push('');

  lines.push('## Saved Items', '');
  if (Object.keys(payload.memoryCounts).length === 0) {
    lines.push('- No notes or memories were saved.');
  } else {
    for (const [memoryType, count] of Object.entries(payload.memoryCounts).sort()) {
      lines.push(`- **${memoryType}**: ${count}`);
    }
  }
  lines.push('');

  if (payload.topMemories.length > 0) {
    lines.push('## Top Memories', '');
    for (const memory of payload.topMemories) {
      lines.push(`- **${memory.title}** (${memory.memoryType}): ${trimTranscript(memory.bodyMd, 200)}`);
    }
    lines.push('');
  }

  if (payload.notableTurns.length > 0) {
    lines.push('## Notable Turns', '');
    for (const turn of payload.notableTurns) {
      lines.push(`- **${turn.role}**: ${turn.transcript}`);
    }
    lines.push('');
  }

  return `${lines.join('\n').trim()}\n`;
}
