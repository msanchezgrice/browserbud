export function mergeIncrementalTranscript(existing: string, incoming?: string): string {
  if (!incoming) {
    return existing;
  }
  if (!existing) {
    return incoming;
  }
  if (incoming === existing || existing.endsWith(incoming)) {
    return existing;
  }
  if (incoming.startsWith(existing)) {
    return incoming;
  }
  if (existing.startsWith(incoming)) {
    return existing;
  }
  if (existing.includes(incoming)) {
    return existing;
  }

  const maxOverlap = Math.min(existing.length, incoming.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (existing.slice(-overlap) === incoming.slice(0, overlap)) {
      return existing + incoming.slice(overlap);
    }
  }

  return existing + incoming;
}

export function truncateSessionHandle(handle: string | null | undefined, visibleChars = 8): string {
  if (!handle) {
    return 'Waiting for handle';
  }
  if (handle.length <= visibleChars * 2) {
    return handle;
  }
  return `${handle.slice(0, visibleChars)}...${handle.slice(-visibleChars)}`;
}

export function formatLatency(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return 'Waiting';
  }
  return `${Math.round(value)} ms`;
}
