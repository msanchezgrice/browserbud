export type CaptureMode = 'screen-share' | 'multimodal' | 'browser-extension';

export type BrowserContextPacket = {
  packetVersion: 1;
  tabId: number;
  windowId: number;
  documentId?: string | null;
  url: string;
  domain: string;
  title: string;
  navEvent: 'activated' | 'committed' | 'completed' | 'history_state_updated' | 'content_snapshot';
  capturedAt: string;
  page: {
    canonicalUrl?: string | null;
    pathname: string;
    search: string;
    hash: string;
    pageTypeHint?: string | null;
    mainTextExcerpt?: string | null;
    documentText?: string | null;
    documentTextLength?: number | null;
    documentTextTruncated?: boolean;
  };
  location: {
    activeSection?: string | null;
    breadcrumbLabels: string[];
    scrollY?: number | null;
    viewportHeight?: number | null;
  };
  contentMap: {
    headings: Array<{ level: number; text: string }>;
    landmarks: Array<{ role: string; label?: string | null }>;
    forms: Array<{ name: string; fields: string[]; submitLabels: string[] }>;
  };
  navMap: {
    primaryLinks: Array<{ label: string; href: string }>;
    localLinks: Array<{ label: string; href: string }>;
    breadcrumbs: Array<{ label: string; href?: string | null }>;
  };
  anchors: Array<{
    anchorId: string;
    role: string;
    name: string;
    selectorHints: string[];
    visible: boolean;
    interactable: boolean;
    nearbyHeading?: string | null;
  }>;
};

function cleanText(value?: string | null): string {
  return (value || '').trim();
}

function normalizeDocumentText(value?: string | null): string {
  return (value || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function uniqueQueryTerms(query: string): string[] {
  return [...new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2),
  )];
}

function getBrowserContextDocumentText(packet: BrowserContextPacket): string {
  return normalizeDocumentText(packet.page.documentText || packet.page.mainTextExcerpt || '');
}

export function splitDocumentTextIntoChunks(text: string, maxChars = 3200): string[] {
  const normalized = normalizeDocumentText(text);
  if (!normalized) {
    return [];
  }

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    if (!currentChunk) {
      if (paragraph.length <= maxChars) {
        currentChunk = paragraph;
        continue;
      }

      for (let offset = 0; offset < paragraph.length; offset += maxChars) {
        chunks.push(paragraph.slice(offset, offset + maxChars).trim());
      }
      continue;
    }

    const candidate = `${currentChunk}\n\n${paragraph}`;
    if (candidate.length <= maxChars) {
      currentChunk = candidate;
      continue;
    }

    chunks.push(currentChunk);
    if (paragraph.length <= maxChars) {
      currentChunk = paragraph;
      continue;
    }

    for (let offset = 0; offset < paragraph.length; offset += maxChars) {
      chunks.push(paragraph.slice(offset, offset + maxChars).trim());
    }
    currentChunk = '';
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks.filter(Boolean);
}

export function readDocumentTextChunk(
  text: string,
  chunkNumber: number,
  maxChars = 3200,
): { chunkNumber: number; totalChunks: number; text: string } | null {
  const chunks = splitDocumentTextIntoChunks(text, maxChars);
  if (!chunks.length) {
    return null;
  }

  const clampedChunkNumber = Math.min(Math.max(Math.floor(chunkNumber || 1), 1), chunks.length);
  return {
    chunkNumber: clampedChunkNumber,
    totalChunks: chunks.length,
    text: chunks[clampedChunkNumber - 1],
  };
}

export function searchDocumentText(
  text: string,
  query: string,
  maxResults = 3,
  maxChars = 3200,
): string[] {
  const normalized = normalizeDocumentText(text);
  const normalizedQuery = cleanText(query).toLowerCase();
  const queryTerms = uniqueQueryTerms(normalizedQuery);
  if (!normalized || !normalizedQuery || !queryTerms.length) {
    return [];
  }

  const rankedResults = splitDocumentTextIntoChunks(normalized, maxChars)
    .map((chunk) => {
      const lowerChunk = chunk.toLowerCase();
      let score = 0;

      if (lowerChunk.includes(normalizedQuery)) {
        score += 8;
      }

      for (const term of queryTerms) {
        if (lowerChunk.includes(term)) {
          score += 3;
        }
      }

      return {
        chunk,
        score,
      };
    })
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || left.chunk.length - right.chunk.length);

  return rankedResults.slice(0, maxResults).map((result) => result.chunk);
}

export function isBrowserContextPacket(value: unknown): value is BrowserContextPacket {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const packet = value as Partial<BrowserContextPacket>;
  return packet.packetVersion === 1
    && typeof packet.tabId === 'number'
    && typeof packet.windowId === 'number'
    && typeof packet.url === 'string'
    && typeof packet.domain === 'string'
    && typeof packet.title === 'string'
    && typeof packet.navEvent === 'string'
    && typeof packet.capturedAt === 'string'
    && Boolean(packet.page && typeof packet.page.pathname === 'string')
    && Boolean(packet.location && Array.isArray(packet.location.breadcrumbLabels))
    && Boolean(packet.contentMap && Array.isArray(packet.contentMap.headings))
    && Boolean(packet.navMap && Array.isArray(packet.navMap.primaryLinks))
    && Array.isArray(packet.anchors);
}

export function getCaptureModeRequirements(mode: CaptureMode) {
  switch (mode) {
    case 'screen-share':
      return {
        requiresScreenShare: true,
        requiresExtension: false,
      };
    case 'browser-extension':
      return {
        requiresScreenShare: false,
        requiresExtension: true,
      };
    case 'multimodal':
    default:
      return {
        requiresScreenShare: true,
        requiresExtension: true,
      };
  }
}

export function buildBrowserContextPrompt(packet: BrowserContextPacket): string {
  const primaryLinks = packet.navMap.primaryLinks
    .map((link) => cleanText(link.label))
    .filter(Boolean)
    .slice(0, 5)
    .join(', ');
  const anchorNames = packet.anchors
    .filter((anchor) => anchor.visible && anchor.interactable)
    .map((anchor) => `${anchor.role}: ${cleanText(anchor.name)}`)
    .filter(Boolean)
    .slice(0, 5)
    .join('; ');
  const breadcrumbs = packet.location.breadcrumbLabels
    .map((label) => cleanText(label))
    .filter(Boolean)
    .join(' > ');
  const excerpt = cleanText(packet.page.mainTextExcerpt);
  const documentTextLength = packet.page.documentTextLength ?? getBrowserContextDocumentText(packet).length;

  const lines = [
    'Context update only. Do not respond aloud to this message.',
    `Active domain: ${packet.domain}`,
    `Current URL: ${packet.url}`,
    `Current path: ${packet.page.pathname || '/'}`,
    `Page title: ${packet.title}`,
  ];

  if (cleanText(packet.location.activeSection)) {
    lines.push(`Active section: ${cleanText(packet.location.activeSection)}`);
  }

  if (breadcrumbs) {
    lines.push(`Breadcrumbs: ${breadcrumbs}`);
  }

  if (primaryLinks) {
    lines.push(`Primary navigation: ${primaryLinks}`);
  }

  if (anchorNames) {
    lines.push(`Visible anchors: ${anchorNames}`);
  }

  if (excerpt) {
    lines.push(`Page summary: ${excerpt}`);
  }

  if (documentTextLength > 0) {
    lines.push(
      packet.page.documentTextTruncated
        ? `Current page corpus available for on-demand inspection: at least ${documentTextLength} characters.`
        : `Current page corpus available for on-demand inspection: ${documentTextLength} characters.`,
    );
  }

  lines.push('Use this browser-native context to improve subsequent answers, navigation help, and saved memory.');
  return lines.join('\n');
}

export function searchBrowserContextDocument(
  packet: BrowserContextPacket,
  query: string,
  maxResults = 3,
): string[] {
  return searchDocumentText(getBrowserContextDocumentText(packet), query, maxResults);
}

export function buildCurrentPageToolSnapshot(packet: BrowserContextPacket) {
  const documentText = getBrowserContextDocumentText(packet);
  const chunks = splitDocumentTextIntoChunks(documentText);

  return {
    url: packet.url,
    title: packet.title,
    pathname: packet.page.pathname || '/',
    activeSection: cleanText(packet.location.activeSection) || null,
    documentTextLength: packet.page.documentTextLength ?? documentText.length,
    documentTextTruncated: Boolean(packet.page.documentTextTruncated),
    chunkCount: chunks.length,
    documentExcerpt: cleanText(chunks[0] || packet.page.mainTextExcerpt || '').slice(0, 1200),
    topHeadings: packet.contentMap.headings.slice(0, 6).map((heading) => heading.text),
    breadcrumbLabels: packet.location.breadcrumbLabels.slice(0, 6),
    anchorNames: packet.anchors.slice(0, 8).map((anchor) => anchor.name),
  };
}

export function isSignificantBrowserContextUpdate(
  previous: BrowserContextPacket | null | undefined,
  next: BrowserContextPacket | null | undefined,
): boolean {
  if (!next) {
    return false;
  }

  if (!previous) {
    return true;
  }

  const navEventChanged = previous.navEvent !== next.navEvent
    && next.navEvent !== 'content_snapshot';

  return previous.url !== next.url
    || previous.title !== next.title
    || cleanText(previous.location.activeSection) !== cleanText(next.location.activeSection)
    || previous.page.pathname !== next.page.pathname
    || previous.page.hash !== next.page.hash
    || navEventChanged;
}
