export const metadata = { title: 'Sin conexión' };

/** Served by the service worker when a page cannot be fetched. Static: it knows nothing of anybody. */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-4">
      <h1 className="text-2xl font-semibold">Sin conexión</h1>
      <p className="text-fg-muted">
        No hemos podido cargar la página. Si tenías documentos a medio enviar, están guardados en
        este dispositivo y se enviarán cuando abras «Subir documentos» con conexión.
      </p>
      {/* A full page load on purpose: it is the network we are testing, not the router. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/"
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 font-medium text-primary-fg"
      >
        Reintentar
      </a>
    </main>
  );
}
