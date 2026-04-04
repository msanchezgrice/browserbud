export type AppSurface = 'landing' | 'app';

export function resolveAppSurface(pathname: string): AppSurface {
  const normalizedPathname = pathname.trim();
  if (normalizedPathname === '/app' || normalizedPathname.startsWith('/app/')) {
    return 'app';
  }
  return 'landing';
}
