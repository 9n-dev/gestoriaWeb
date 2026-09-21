'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const INTERVAL_MS = 60_000;

/**
 * Keeps the server-rendered counters (bell, unread threads, inbox) fresh without a reload: asks
 * the server again once a minute and when the tab comes back to the front. It stays out of the
 * way: never while somebody is typing, has a dialog open or the tab is hidden.
 * ponytail: polling every 60 s; server-sent events if "within a minute" stops being good enough.
 */
export function AutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const busy = () => {
      const active = document.activeElement;
      return (
        document.visibilityState !== 'visible' ||
        document.querySelector('dialog[open]') !== null ||
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement
      );
    };
    const refresh = () => {
      if (!busy()) router.refresh();
    };
    const timer = setInterval(refresh, INTERVAL_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [router]);
  return null;
}
