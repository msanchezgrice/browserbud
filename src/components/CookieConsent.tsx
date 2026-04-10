import { useEffect, useState } from 'react';
import { acceptAnalytics, declineAnalytics, hasCookieConsent } from '../analytics/posthog';

export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Delay slightly so the banner doesn't cause layout shift during initial paint.
    const timer = setTimeout(() => {
      setVisible(!hasCookieConsent());
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  const handleAccept = () => {
    acceptAnalytics();
    setVisible(false);
  };

  const handleDecline = () => {
    declineAnalytics();
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md rounded-xl border border-stone-200 bg-white p-4 shadow-lg"
    >
      <p className="text-sm text-stone-600">
        We use cookies to understand how BrowserBud is used and to improve your experience. No data is
        collected until you accept.
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={handleDecline}
          className="rounded-lg px-3 py-1.5 text-sm text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700"
        >
          Decline
        </button>
        <button
          onClick={handleAccept}
          className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-teal-700"
        >
          Accept
        </button>
      </div>
    </div>
  );
}
