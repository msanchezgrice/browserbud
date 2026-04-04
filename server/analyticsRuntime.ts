import path from 'node:path';

import type { AnalyticsStoreAdapter } from './analyticsBackend.js';
import { PostgresAnalyticsStore } from './postgresAnalyticsStore.js';
import { UnavailableAnalyticsStore } from './unavailableAnalyticsStore.js';

let singletonStore: AnalyticsStoreAdapter | null = null;
let singletonStoreKey: string | null = null;

type AnalyticsRuntimeConfig =
  | { kind: 'postgres'; key: string; connectionString: string }
  | { kind: 'sqlite'; key: string; dbPath: string }
  | { kind: 'unavailable'; key: string; message: string };

function trimToValue(value?: string | null): string {
  return (value || '').trim();
}

function resolveAnalyticsDatabaseUrl(): string | null {
  return trimToValue(
    process.env.BROWSERBUD_DATABASE_URL
      || process.env.POSTGRES_URL
      || process.env.DATABASE_URL,
  ) || null;
}

function resolveLocalAnalyticsDbPath(): string {
  return process.env.BROWSERBUD_LOCAL_DB_PATH
    || path.resolve(process.cwd(), 'data/browserbud.sqlite');
}

export function resolveAnalyticsRuntimeConfig(): AnalyticsRuntimeConfig {
  const databaseUrl = resolveAnalyticsDatabaseUrl();
  if (databaseUrl) {
    return {
      kind: 'postgres',
      key: `postgres:${databaseUrl}`,
      connectionString: databaseUrl,
    };
  }

  if (process.env.VERCEL || process.env.VERCEL_ENV) {
    return {
      kind: 'unavailable',
      key: 'unavailable:vercel',
      message: 'Shared analytics backend is not configured. Set BROWSERBUD_DATABASE_URL, POSTGRES_URL, or DATABASE_URL on Vercel and redeploy.',
    };
  }

  const dbPath = resolveLocalAnalyticsDbPath();
  return {
    kind: 'sqlite',
    key: `sqlite:${dbPath}`,
    dbPath,
  };
}

export async function getAnalyticsStore(): Promise<AnalyticsStoreAdapter> {
  const config = resolveAnalyticsRuntimeConfig();
  if (singletonStore && singletonStoreKey === config.key) {
    return singletonStore;
  }

  if (singletonStore) {
    await singletonStore.close();
  }

  if (config.kind === 'postgres') {
    singletonStore = new PostgresAnalyticsStore({ connectionString: config.connectionString });
    await singletonStore.initialize();
    singletonStoreKey = config.key;
    return singletonStore;
  }

  if (config.kind === 'sqlite') {
    const { AnalyticsStore } = await import('./analyticsStore.js');
    singletonStore = new AnalyticsStore({ dbPath: config.dbPath });
    await singletonStore.initialize();
    singletonStoreKey = config.key;
    return singletonStore;
  }

  singletonStore = new UnavailableAnalyticsStore(config.message);
  singletonStoreKey = config.key;
  return singletonStore;
}

export async function closeAnalyticsStore(): Promise<void> {
  if (!singletonStore) {
    return;
  }

  await singletonStore.close();
  singletonStore = null;
  singletonStoreKey = null;
}
