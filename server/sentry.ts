// Server-side Sentry initialization.
// Used by both the local Express dev server and Vercel serverless functions.
// Safe to call multiple times — initialization is idempotent.

import * as Sentry from '@sentry/node';

let initialized = false;

export function initServerSentry(): void {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'production',
    // 10% of server transactions for performance monitoring.
    tracesSampleRate: 0.1,
  });

  initialized = true;
}

// Capture an exception from a server-side error handler.
// Initializes Sentry on first call if not already done.
export function captureServerException(error: unknown): void {
  initServerSentry();
  if (error instanceof Error) {
    Sentry.captureException(error);
  }
}

export { Sentry };
