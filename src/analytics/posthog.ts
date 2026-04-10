// PostHog product analytics.
// Loaded lazily (dynamic import) so it never blocks the critical rendering path.
// All event capture is gated behind cookie consent — no data is sent until the
// user explicitly clicks "Accept" on the cookie consent banner.

const CONSENT_KEY = 'browserbud.cookieConsent';

type PostHogLib = typeof import('posthog-js').default;

let _posthog: PostHogLib | null = null;
let _initPromise: Promise<void> | null = null;

export function getCookieConsent(): 'accepted' | 'declined' | null {
  try {
    return localStorage.getItem(CONSENT_KEY) as 'accepted' | 'declined' | null;
  } catch {
    return null;
  }
}

export function hasCookieConsent(): boolean {
  return getCookieConsent() !== null;
}

// Dynamically import posthog-js so it is code-split into its own chunk and
// does not block the initial page render (equivalent to next/script lazyOnload).
export async function initPostHog(): Promise<void> {
  const apiKey = import.meta.env.VITE_POSTHOG_API_KEY as string | undefined;
  if (!apiKey) return;

  if (_initPromise) return _initPromise;

  _initPromise = import('posthog-js').then(({ default: posthog }) => {
    const consent = getCookieConsent();
    posthog.init(apiKey, {
      api_host: (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://us.i.posthog.com',
      autocapture: true,
      // Manual pageview tracking so we control when $pageview fires for SPA navigation.
      capture_pageview: false,
      // Opt out by default until the user explicitly accepts — satisfies GDPR requirement.
      opt_out_capturing_by_default: consent !== 'accepted',
    });
    _posthog = posthog;
  });

  return _initPromise;
}

export function capturePageView(): void {
  if (!_posthog) return;
  if (_posthog.has_opted_out_capturing()) return;
  _posthog.capture('$pageview', { $current_url: window.location.href });
}

// Called when the user clicks "Accept" on the cookie consent banner.
export function acceptAnalytics(): void {
  try {
    localStorage.setItem(CONSENT_KEY, 'accepted');
  } catch {
    // ignore
  }
  if (_posthog) {
    _posthog.opt_in_capturing();
    capturePageView();
  } else {
    // PostHog may not be initialized yet on very fast clicks — init and then capture.
    initPostHog().then(() => capturePageView());
  }
}

// Called when the user clicks "Decline" on the cookie consent banner.
export function declineAnalytics(): void {
  try {
    localStorage.setItem(CONSENT_KEY, 'declined');
  } catch {
    // ignore
  }
  _posthog?.opt_out_capturing();
}

export function getPostHog(): PostHogLib | null {
  return _posthog;
}
