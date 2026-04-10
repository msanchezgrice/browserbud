// Sentry error tracking — initialized at app startup before any React renders.
// Captures JS errors, unhandled promise rejections, and React render errors.
// Bot traffic is filtered out via the beforeSend hook to prevent noise.

import * as Sentry from '@sentry/react';

const BOT_UA_PATTERNS = [
  /Googlebot/i,
  /bingbot/i,
  /Slurp/i,
  /DuckDuckBot/i,
  /Baiduspider/i,
  /YandexBot/i,
  /Sogou/i,
  /Exabot/i,
  /facebookexternalhit/i,
  /ia_archiver/i,
  /Twitterbot/i,
  /LinkedInBot/i,
  /Discordbot/i,
  /AhrefsBot/i,
  /SemrushBot/i,
];

function isBot(): boolean {
  return BOT_UA_PATTERNS.some((pattern) => pattern.test(navigator.userAgent));
}

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;

  // Don't initialize Sentry for bots — avoids quota noise from crawlers.
  if (isBot()) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    integrations: [Sentry.browserTracingIntegration()],
    // 10% of transactions for performance monitoring — keeps quota low.
    tracesSampleRate: 0.1,
    beforeSend(event) {
      // Double-check on each event in case the UA changed (e.g. headless browsers).
      if (isBot()) return null;
      return event;
    },
  });
}

export { Sentry };
