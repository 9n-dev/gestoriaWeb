import { redirect } from 'next/navigation';
import { ConfirmForm } from './confirm-form';

/**
 * Landing page of the magic link. The token is only consumed when the person presses the
 * button (POST): mail scanners that prefetch links cannot burn it.
 */
export default async function MagicLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) redirect('/acceso');

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Confirma el acceso</h1>
        <p className="mt-1 text-fg-muted">Pulsa el botón para entrar en tu portal.</p>
      </div>
      <ConfirmForm token={token} />
    </div>
  );
}
