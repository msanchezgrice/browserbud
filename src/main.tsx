import { StrictMode, Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import posthog from 'posthog-js';
import { resolveAppSurface, type AppSurface } from './appSurface';
import './index.css';

const posthogToken = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN?.trim();
if (posthogToken) {
  posthog.init(posthogToken, {
    api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',
    ui_host: 'https://us.posthog.com',
    defaults: '2026-05-30',
    capture_exceptions: true,
    debug: import.meta.env.DEV,
  });
  posthog.register({ site_id: 'browserbud.com', site_name: 'BrowserBud' });
}

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

  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#FAFAF8] text-sm text-stone-500">
          Loading BrowserBud…
        </div>
      }
    >
      {route === 'app' ? <App /> : <Landing />}
    </Suspense>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router />
  </StrictMode>,
);
