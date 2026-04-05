export type AppSurface = 'landing' | 'app';
export type AppTabRoute = 'transcript' | 'info' | 'activity' | 'notes' | 'history' | 'memory';

const PRODUCT_TAB_ALIASES: Record<string, AppTabRoute> = {
  transcript: 'transcript',
  info: 'info',
  helpful: 'info',
  'helpful-info': 'info',
  activity: 'activity',
  notes: 'notes',
  history: 'history',
  memory: 'memory',
};

function normalizePathname(pathname: string): string {
  const normalized = pathname.trim() || '/';
  return normalized.endsWith('/') && normalized !== '/' ? normalized.slice(0, -1) : normalized;
}

export function resolveAppTabRoute(pathname: string): AppTabRoute {
  const normalizedPathname = normalizePathname(pathname);
  if (normalizedPathname === '/app') {
    return 'transcript';
  }

  if (normalizedPathname.startsWith('/app/')) {
    const tabSegment = normalizedPathname.slice('/app/'.length);
    return PRODUCT_TAB_ALIASES[tabSegment] || 'transcript';
  }

  if (normalizedPathname.startsWith('/product/')) {
    const tabSegment = normalizedPathname.slice('/product/'.length);
    return PRODUCT_TAB_ALIASES[tabSegment] || 'transcript';
  }

  return 'transcript';
}

export function buildAppTabPath(tab: AppTabRoute): string {
  switch (tab) {
    case 'transcript':
      return '/app';
    case 'info':
      return '/app/helpful-info';
    case 'activity':
      return '/app/activity';
    case 'notes':
      return '/app/notes';
    case 'history':
      return '/app/history';
    case 'memory':
      return '/app/memory';
    default:
      return '/app';
  }
}

export function resolveAppSurface(pathname: string): AppSurface {
  const normalizedPathname = normalizePathname(pathname);
  const productSegment = normalizedPathname.startsWith('/product/')
    ? normalizedPathname.slice('/product/'.length)
    : null;
  if (
    normalizedPathname === '/app'
    || normalizedPathname.startsWith('/app/')
    || Boolean(productSegment && PRODUCT_TAB_ALIASES[productSegment])
  ) {
    return 'app';
  }
  return 'landing';
}
