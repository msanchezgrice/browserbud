export const DEFAULT_LOCAL_ANALYTICS_API_URL = 'http://127.0.0.1:3011/api/analytics';
export const BROWSERBUD_API_KEY_STORAGE_KEY = 'browserbud.userGeminiApiKey';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

type ResolveAnalyticsApiUrlInput = {
  configuredUrl?: string | null;
  windowOrigin?: string | null;
  windowHostname?: string | null;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function trimToValue(value?: string | null): string {
  return (value || '').trim();
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function resolveAnalyticsApiUrl(input: ResolveAnalyticsApiUrlInput = {}): string | null {
  const configuredUrl = stripTrailingSlash(trimToValue(input.configuredUrl));
  if (configuredUrl) {
    return configuredUrl;
  }

  const windowHostname = trimToValue(input.windowHostname).toLowerCase();
  if (windowHostname && !LOCAL_HOSTNAMES.has(windowHostname)) {
    return null;
  }

  return DEFAULT_LOCAL_ANALYTICS_API_URL;
}

export function createStoredApiKeyController(storage: StorageLike | null | undefined) {
  return {
    get(): string {
      if (!storage) {
        return '';
      }
      return trimToValue(storage.getItem(BROWSERBUD_API_KEY_STORAGE_KEY));
    },
    set(nextValue: string) {
      if (!storage) {
        return;
      }
      const sanitized = trimToValue(nextValue);
      if (!sanitized) {
        storage.removeItem(BROWSERBUD_API_KEY_STORAGE_KEY);
        return;
      }
      storage.setItem(BROWSERBUD_API_KEY_STORAGE_KEY, sanitized);
    },
    clear() {
      if (!storage) {
        return;
      }
      storage.removeItem(BROWSERBUD_API_KEY_STORAGE_KEY);
    },
  };
}
