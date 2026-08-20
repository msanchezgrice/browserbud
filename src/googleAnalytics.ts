const FALLBACK_MEASUREMENT_ID = 'G-ZFQ1VLWGMM';

const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const configuredMeasurementId = viteEnv?.VITE_GA_MEASUREMENT_ID?.trim();
export const GOOGLE_ANALYTICS_MEASUREMENT_ID =
  configuredMeasurementId && /^G-[A-Z0-9]+$/.test(configuredMeasurementId)
    ? configuredMeasurementId
    : FALLBACK_MEASUREMENT_ID;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    __browserBudGa4Installed?: boolean;
  }
}

export function installGoogleAnalytics(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined' || window.__browserBudGa4Installed) {
    return;
  }

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || ((...args: unknown[]) => window.dataLayer?.push(args));
  window.gtag('js', new Date());
  window.gtag('config', GOOGLE_ANALYTICS_MEASUREMENT_ID, {
    send_page_view: true,
    anonymize_ip: true,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });

  if (!document.querySelector('script[data-ga4-loader="true"]')) {
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ANALYTICS_MEASUREMENT_ID}`;
    script.dataset.ga4Loader = 'true';
    document.head.appendChild(script);
  }
  window.__browserBudGa4Installed = true;
}

export function trackGoogleAnalyticsPageView(path = `${window.location.pathname}${window.location.search}`): void {
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag('event', 'page_view', {
      page_path: path,
      page_location: window.location.href,
      page_title: document.title,
    });
  }
}
