import { StrictMode, Suspense, lazy, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { capturePageView, initPostHog } from './analytics/posthog';
import { initSentry } from './analytics/sentry';
import { CookieConsent } from './components/CookieConsent';
import { GlobalErrorBoundary } from './components/GlobalErrorBoundary';
import { resolveAppSurface, type AppSurface } from './appSurface';
import './index.css';

// Initialize Sentry synchronously before any React renders so that errors
// during startup (including lazy-load failures) are captured.
initSentry();

const App = lazy(() => import('./App.tsx'));
const Landing = lazy(() => import('./Landing.tsx'));

function getRoute(): AppSurface {
  if (window.location.hash === '#/app') {
    return resolveAppSurface('/app');
  }
  return resolveAppSurface(window.location.pathname);
}

function Router() {
  const [route, setRoute] = useState<AppSurface>(() => getRoute());
  // Tracks whether the initial pageview has been captured so that SPA
  // navigation events (popstate/hashchange) don't double-count page 1.
  const initialPageViewCaptured = useRef(false);

  // Lazy-load PostHog after first render so it never blocks the critical path.
  useEffect(() => {
    initPostHog().then(() => {
      if (!initialPageViewCaptured.current) {
        capturePageView();
        initialPageViewCaptured.current = true;
      }
    });
  }, []);

  useEffect(() => {
    const syncRoute = () => {
      if (window.location.hash === '#/app' && window.location.pathname !== '/app') {
        window.history.replaceState(null, '', '/app');
      }
      setRoute(getRoute());
    };

    window.addEventListener('popstate', syncRoute);
    window.addEventListener('hashchange', syncRoute);
    syncRoute();

    return () => {
      window.removeEventListener('popstate', syncRoute);
      window.removeEventListener('hashchange', syncRoute);
    };
  }, []);

  // Fire a $pageview on every client-side route change after the initial load.
  useEffect(() => {
    if (!initialPageViewCaptured.current) return;
    capturePageView();
  }, [route]);

  return (
    <>
      <Suspense
        fallback={
          <div className="flex min-h-screen items-center justify-center bg-[#FAFAF8] text-sm text-stone-500">
            Loading BrowserBud…
          </div>
        }
      >
        {route === 'app' ? <App /> : <Landing />}
      </Suspense>
      <CookieConsent />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GlobalErrorBoundary>
      <Router />
    </GlobalErrorBoundary>
  </StrictMode>,
);
