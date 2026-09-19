import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { formatLongDate, isoDate, todayInMadrid } from '@/lib/dates';
import { CLIENT_STATUS, OBLIGATION_STATUS, USER_STATUS, periodLabel } from '@/lib/labels';
import { relativeDays, resultLabel } from '@/lib/labels-obligations';
import { recentQuarters } from '@/lib/periods';
import { getClientChecklist } from '@/modules/checklists/service';
import { DOCUMENT_STATUS, PERMANENT_CATEGORY, fileStatusNote } from '@/lib/labels-documents';
import { requireArea } from '@/modules/auth/area';
import { listClientUsers } from '@/modules/auth/invitations';
import { can } from '@/modules/auth/permissions';
import { listAssignableManagers, loadForStaff, resourceOf } from '@/modules/clients/service';
import { listTaxProfiles } from '@/modules/clients/tax-profiles/service';
import { listInboundAddresses } from '@/modules/documents/inbound/service';
import { listPermanentDocuments } from '@/modules/documents/permanent';
import { listClientDocuments } from '@/modules/documents/service';
import { knownModels, modelName } from '@/modules/obligations/calendar';
import { listClientObligations } from '@/modules/obligations/workflow';
import { getCurrentTenant } from '@/modules/tenants/current';
import { ChecklistSection } from './checklist-section';
import { ObligationsSection } from './obligations-section';
import { PermanentUpload } from './permanent-upload';
import {
  DeletePermanentButton,
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

  const tenant = await getCurrentTenant();
  const today = todayInMadrid();
  const checklist = await getClientChecklist(user, id, { today });
  const [obligations, documents, permanent, addresses, profiles, managers, users] =
    await Promise.all([
      listClientObligations(user, id),
      listClientDocuments(user, id),
      listPermanentDocuments(user, id),
      tenant ? listInboundAddresses(tenant, [id]) : [],
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

      {checklist && (
        <Section title="Documentación del periodo">
          <ChecklistSection
            clientId={id}
            period={{
              year: checklist.period.year,
              type: checklist.period.type,
              ordinal: checklist.period.ordinal,
            }}
            periodText={periodLabel(checklist.period)}
            deadlineText={`${formatLongDate(checklist.deadline)} (${relativeDays(today, checklist.deadline)})`}
            light={checklist.light}
            closed={checklist.closed}
            items={checklist.items}
            canManage={can(user, 'checklist.manage', resource)}
          />
        </Section>
      )}

      <Section title="Obligaciones fiscales">
        <ObligationsSection
          clientId={id}
          canUpdate={can(user, 'obligation.update', resource)}
          models={knownModels().map((model) => ({ model, name: modelName(model) }))}
          periods={recentQuarters(today, 6)}
          obligations={obligations.map((o) => ({
            id: o.id,
            model: o.model,
            modelName: modelName(o.model),
            periodText: periodLabel(o.period),
            dueText: formatLongDate(o.dueDate),
            relative: relativeDays(today, isoDate(o.dueDate)),
            overdue: o.status !== 'FILED' && isoDate(o.dueDate) < today,
            status: o.status,
            statusText: OBLIGATION_STATUS[o.status],
            estimate: o.estimatedAmount?.toString().replace('.', ',') ?? '',
            resultText: resultLabel(o),
            receiptFileId: o.receiptFile && !o.receiptFile.deletedAt ? o.receiptFile.id : null,
          }))}
        />
      </Section>

      <Section title="Documentos">
        <p className="text-sm text-fg-muted">
          {documents.length === 0
            ? 'Todavía no ha enviado documentos.'
            : `${documents.length} documentos.`}{' '}
          <Link href={`/panel/bandeja?cliente=${id}`} className="underline">
            Ver los pendientes en la bandeja
          </Link>
          {addresses[0] && (
            <>
              {' '}
              · Correo para enviar documentos:{' '}
              <code className="break-all">{addresses[0].address}</code>
            </>
          )}
        </p>
        {documents.length > 0 && (
          <ul className="flex flex-col text-sm">
            {documents.slice(0, 10).map((document) => (
              <li
                key={document.id}
                className="flex flex-wrap justify-between gap-x-4 border-b border-border py-1.5"
              >
                <a
                  href={`/api/files/${document.file.id}?inline`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  {document.file.originalName}
                </a>
                <span className="text-fg-muted">
                  {document.period && `${periodLabel(document.period)} · `}
                  {fileStatusNote(document.file.status) ?? DOCUMENT_STATUS[document.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Documentación permanente">
        {permanent.length > 0 && (
          <ul className="flex flex-col text-sm">
            {permanent.map((document) => (
              <li
                key={document.id}
                className="flex flex-wrap items-center justify-between gap-x-4 border-b border-border py-1.5"
              >
                <span>
                  <a
                    href={`/api/files/${document.file.id}?inline`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {document.title}
                  </a>{' '}
                  <span className="text-fg-muted">
                    · {PERMANENT_CATEGORY[document.category]}
                    {fileStatusNote(document.file.status) &&
                      ` · ${fileStatusNote(document.file.status)}`}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-fg-muted">
                    {document.expiresAt
                      ? `Caduca el ${formatLongDate(document.expiresAt)}`
                      : 'Sin caducidad'}
                  </span>
                  {can(user, 'permanentDocument.manage', resource) && (
                    <DeletePermanentButton clientId={id} id={document.id} />
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {can(user, 'permanentDocument.manage', resource) && <PermanentUpload clientId={id} />}
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
