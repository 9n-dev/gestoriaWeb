'use client';

import { useEffect } from 'react';
import { reportBrowserError } from '@/components/report-browser-errors';
import { Button } from '@/components/ui/button';

/** Any page that fails to render. Server-side failures were already reported by instrumentation.ts. */
export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  // Render errors are caught by this boundary and never reach window.onerror.
  useEffect(() => reportBrowserError(error), [error]);
  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-md flex-col justify-center gap-4 p-4">
      <h1 className="text-2xl font-semibold">Algo ha salido mal</h1>
      <p className="text-fg-muted">
        No hemos podido cargar esta página. Inténtalo de nuevo; si sigue pasando, avisa a tu
        gestoría.
      </p>
      <Button type="button" onClick={reset} className="self-start">
        Reintentar
      </Button>
    </main>
  );
}
