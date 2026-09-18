import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { formatLongDate } from '@/lib/dates';
import { CLIENT_STATUS, OBLIGATION_STATUS, USER_STATUS, periodLabel } from '@/lib/labels';
import { requireArea } from '@/modules/auth/area';
import { listClientUsers } from '@/modules/auth/invitations';
import { can } from '@/modules/auth/permissions';
import { listAssignableManagers, loadForStaff, resourceOf } from '@/modules/clients/service';
import { listTaxProfiles } from '@/modules/clients/tax-profiles/service';
import { modelName } from '@/modules/obligations/calendar';
import { listClientObligations } from '@/modules/obligations/queries';
import {
  DeleteSection,
  InviteSection,
  ManagerSection,
  NotesSection,
  ResendButton,
  TaxProfileSection,
} from './sections';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireArea('area.staff');
  const { id } = await params;
  const client = await loadForStaff(user, id).catch(() => notFound());
  const resource = resourceOf(client);

  const [obligations, profiles, managers, users] = await Promise.all([
    listClientObligations(user, id),
    listTaxProfiles(user),
    can(user, 'client.assignManager', resource) ? listAssignableManagers(user) : null,
    can(user, 'client.inviteUser', resource) ? listClientUsers(user, id) : null,
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-fg-muted">
            <Link href="/panel/clientes" className="underline">
              Clientes
            </Link>
          </p>
          <h1 className="text-2xl font-semibold">{client.legalName}</h1>
          <p className="text-fg-muted">
            {client.taxId} · {CLIENT_STATUS[client.status]}
            {client.tags.length > 0 && ` · ${client.tags.join(', ')}`}
          </p>
          <p className="text-sm text-fg-muted">
            {[client.email, client.phone, client.addressLine, client.postalCode, client.city]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {can(user, 'client.update', resource) && (
          <Link
            href={`/panel/clientes/${id}/editar`}
            className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface-muted"
          >
            Editar datos
          </Link>
        )}
      </div>

      <Section title="Obligaciones fiscales">
        {obligations.length === 0 ? (
          <p className="text-fg-muted">Asigna un perfil fiscal para generar sus obligaciones.</p>
        ) : (
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Próximas obligaciones del cliente</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="py-2 pr-4 font-medium">
                  Modelo
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Periodo
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Fecha límite
                </th>
                <th scope="col" className="py-2 font-medium">
                  Estado
                </th>
              </tr>
            </thead>
            <tbody>
              {obligations.map((obligation) => (
                <tr key={obligation.id} className="border-b border-border">
                  <td className="py-2 pr-4">
                    <span className="font-medium">{obligation.model}</span>{' '}
                    <span className="text-fg-muted">{modelName(obligation.model)}</span>
                  </td>
                  <td className="py-2 pr-4">{periodLabel(obligation.period)}</td>
                  <td className="py-2 pr-4">{formatLongDate(obligation.dueDate)}</td>
                  <td className="py-2">{OBLIGATION_STATUS[obligation.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {can(user, 'client.assignTaxProfile', resource) && (
        <Section title="Perfil fiscal">
          <TaxProfileSection clientId={id} current={client.taxProfileId} profiles={profiles} />
        </Section>
      )}

      {managers && (
        <Section title="Gestor">
          <ManagerSection clientId={id} current={client.assignedManagerId} managers={managers} />
        </Section>
      )}

      {users && (
        <Section title="Acceso al portal">
          {users.length > 0 && (
            <ul className="flex flex-col gap-2 text-sm">
              {users.map((person) => (
                <li key={person.id} className="flex flex-wrap items-center gap-x-3">
                  <span className="font-medium">{person.name}</span>
                  <span className="text-fg-muted">{person.email}</span>
                  <span>{USER_STATUS[person.status]}</span>
                  {person.status === 'INVITED' && <ResendButton userId={person.id} />}
                </li>
              ))}
            </ul>
          )}
          <InviteSection
            clientId={id}
            defaultEmail={users.length ? '' : (client.email ?? '')}
            defaultName=""
          />
        </Section>
      )}

      {can(user, 'client.writeInternalNotes', resource) && (
        <Section title="Notas internas">
          <NotesSection clientId={id} notes={client.internalNotes} />
        </Section>
      )}

      {can(user, 'client.delete', resource) && <DeleteSection clientId={id} />}
    </div>
  );
}
