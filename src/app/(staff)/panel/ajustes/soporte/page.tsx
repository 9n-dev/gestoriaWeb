import { notFound } from 'next/navigation';
import { formatDateTime } from '@/lib/dates';
import { requireArea } from '@/modules/auth/area';
import { can } from '@/modules/auth/permissions';
import { listSupportGrants } from '@/modules/platform/support';
import { GrantSupportForm, RevokeSupportForm } from './forms';

export default async function SupportSettingsPage() {
  const user = await requireArea('area.staff');
  if (!can(user, 'support.grant')) notFound();
  const grants = await listSupportGrants(user);
  const now = new Date();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Modo soporte</h1>
      <p className="max-w-prose text-sm text-fg-muted">
        El equipo de la plataforma no puede ver los datos de tu gestoría. Si necesitas ayuda, abre
        aquí un acceso temporal de solo lectura: no pueden descargar archivos ni cambiar nada, el
        acceso caduca solo y todo queda en el registro de auditoría.
      </p>
      <GrantSupportForm />
      {grants.length > 0 && (
        <ul className="flex max-w-3xl flex-col divide-y divide-border border-t border-border">
          {grants.map((grant) => {
            const open = !grant.revokedAt && grant.expiresAt > now;
            return (
              <li
                key={grant.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
              >
                <span>
                  <span className="block">{grant.reason}</span>
                  <span className="text-fg-muted">
                    {grant.grantedBy.name} · {formatDateTime(grant.createdAt)} ·{' '}
                    {open
                      ? `abierto hasta ${formatDateTime(grant.expiresAt)}`
                      : grant.revokedAt
                        ? 'cerrado a mano'
                        : 'caducado'}
                  </span>
                </span>
                {open && <RevokeSupportForm grantId={grant.id} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
