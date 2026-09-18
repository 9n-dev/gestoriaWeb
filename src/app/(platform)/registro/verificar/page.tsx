import { redirect } from 'next/navigation';
import { VerifyForm } from '../../tenant-forms';

/** Confirmed on POST, so mail scanners that prefetch the link cannot consume it. */
export default async function VerifyRegistrationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) redirect('/registro');
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-4">
      <div>
        <h1 className="text-2xl font-semibold">Confirma tu correo</h1>
        <p className="mt-1 text-fg-muted">Un clic más y tu portal estará activo.</p>
      </div>
      <VerifyForm token={token} />
    </main>
  );
}
