import path from 'node:path';

import { AnalyticsStore } from './analyticsStore';

let singletonStore: AnalyticsStore | null = null;
let singletonDbPath: string | null = null;

function resolveAnalyticsDbPath(): string {
  const configuredPath = process.env.BROWSERBUD_LOCAL_DB_PATH || process.env.BROWSERBUD_DB_PATH;
  if (configuredPath) {
    return configuredPath;
  }

  if (process.env.VERCEL || process.env.VERCEL_ENV) {
    return '/tmp/browserbud.sqlite';
  }

  return path.resolve(process.cwd(), 'data/browserbud.sqlite');
}

export function getAnalyticsStore(): AnalyticsStore {
  const dbPath = resolveAnalyticsDbPath();
  if (singletonStore && singletonDbPath === dbPath) {
    return singletonStore;
  }

  if (singletonStore) {
    singletonStore.close();
  }

  singletonStore = new AnalyticsStore({ dbPath });
  singletonStore.initialize();
  singletonDbPath = dbPath;
  return singletonStore;
}
