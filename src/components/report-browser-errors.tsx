'use client';

import { useEffect } from 'react';

const MAX_PER_PAGE = 5;

/** Sends uncaught browser errors to `/api/errors`. Best effort: never throws, never loops. */
export function reportBrowserError(error: unknown): void {
  try {
    const failure = error instanceof Error ? error : new Error(String(error));
    const body = JSON.stringify({
      message: failure.message.slice(0, 500),
      stack: failure.stack?.slice(0, 4000),
      // Path only: query strings can carry tokens.
      path: window.location.pathname,
    });
    if (!navigator.sendBeacon?.('/api/errors', body)) {
      void fetch('/api/errors', { method: 'POST', body, keepalive: true }).catch(() => {});
    }
  } catch {
    // Reporting must never be the thing that breaks the page.
  }
}

export function ReportBrowserErrors() {
  useEffect(() => {
    let sent = 0;
    const report = (error: unknown) => {
      if (sent++ < MAX_PER_PAGE) reportBrowserError(error);
    };
    const onError = (event: ErrorEvent) => report(event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent) => report(event.reason);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}
