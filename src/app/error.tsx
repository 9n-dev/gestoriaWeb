'use client';

import { Button } from '@/components/ui/button';

/** Any page that fails to render. The server side has already reported it (instrumentation.ts). */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
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
