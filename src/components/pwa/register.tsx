'use client';

import { useEffect } from 'react';

/** Registers the service worker (offline page, asset cache, push). Renders nothing. */
export function RegisterServiceWorker() {
  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
  return null;
}
