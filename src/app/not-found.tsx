import Link from 'next/link';

export default function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-md flex-col justify-center gap-4 p-4">
      <h1 className="text-2xl font-semibold">No encontramos esa página</h1>
      <p className="text-fg-muted">Puede que el enlace sea antiguo o que ya no tengas acceso.</p>
      <Link href="/" className="underline">
        Volver al inicio
      </Link>
    </main>
  );
}
