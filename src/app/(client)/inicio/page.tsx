import Link from 'next/link';
import { LightBadge } from '@/components/light-badge';
import { formatLongDate, todayInMadrid } from '@/lib/dates';
import { periodLabel } from '@/lib/labels';
import { relativeDays } from '@/lib/labels-obligations';
import { requireArea } from '@/modules/auth/area';
import { getClientChecklist } from '@/modules/checklists/service';
import { listClientsFor } from '@/modules/clients/service';

export default async function ClientHomePage() {
  const user = await requireArea('area.client');
  const today = todayInMadrid();
  const clients = await listClientsFor(user);
  const checklists = await Promise.all(
    clients.map((client) => getClientChecklist(user, client.id, { today })),
  );

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Hola, {user.name.split(' ')[0]}</h1>
      <Link
        href="/subir"
        className="flex min-h-20 items-center justify-center rounded-lg bg-primary px-6 text-lg font-semibold text-primary-fg"
      >
        Subir documentos
      </Link>

      <ul className="flex flex-col gap-3">
        {clients.map((client, index) => {
          const checklist = checklists[index];
          return (
            <li key={client.id} className="flex flex-col gap-2 rounded-md border border-border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <p className="font-medium">{client.legalName}</p>
                {checklist && (
                  <LightBadge
                    light={checklist.light}
                    text={
                      checklist.missing.length
                        ? `Faltan ${checklist.missing.length} de ${checklist.items.length}`
                        : 'Todo entregado'
                    }
                  />
                )}
              </div>
              {checklist && checklist.missing.length > 0 && (
                <div className="text-sm">
                  <p>
                    Para {periodLabel(checklist.period)} todavía nos falta (antes del{' '}
                    {formatLongDate(checklist.deadline)}, {relativeDays(today, checklist.deadline)}
                    ):
                  </p>
                  <ul className="mt-1 list-disc pl-5">
                    {checklist.missing.map((label) => (
                      <li key={label}>{label}</li>
                    ))}
                  </ul>
                  {checklist.closed && (
                    <p className="mt-2 text-fg-muted">
                      Tu gestor ha cerrado la documentación de este periodo. Si necesitas añadir
                      algo, escríbele.
                    </p>
                  )}
                </div>
              )}
              {checklist && checklist.missing.length === 0 && (
                <p className="text-sm text-fg-muted">
                  Tenemos todo lo de {periodLabel(checklist.period)}. ¡Gracias!
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <Link href="/plazos" className="self-start text-sm underline">
        Ver mis próximos plazos
      </Link>
    </div>
  );
}
