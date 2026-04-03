import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import Landing from './Landing.tsx';
import './index.css';

type Route = 'landing' | 'app';

function getRoute(): Route {
  if (window.location.pathname === '/app' || window.location.pathname.startsWith('/app/')) {
    return 'app';
  }
  if (window.location.hash === '#/app') {
    return 'app';
  }
  return 'landing';
}

function Router() {
  const [route, setRoute] = useState<Route>(() => getRoute());

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

  if (route === 'app') return <App />;
  return <Landing />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router />
  </StrictMode>,
);
