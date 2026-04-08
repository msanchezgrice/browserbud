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

  lines.push('Use this browser-native context to improve subsequent answers, navigation help, and saved memory.');
  return lines.join('\n');
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
